import React,{useState,useEffect,useRef,useLayoutEffect,createContext,useContext} from 'react';
import type {ApiClient} from '../../apps/shop/src/api';
import {RequestImagePicker} from '../../apps/shop/src/RequestImagePicker';
import {MenuImage} from '../../apps/shop/src/MenuImage';
import {DictationButton} from '../../apps/shop/src/DictationButton';
import {VisualChangeReview} from '../../apps/shop/src/VisualChangeReview';
import {AnnotationCanvas} from '../../apps/shop/src/AnnotationCanvas';
import {useChatPanelCollapse} from '../../apps/shop/src/ChatPanelCollapse';
import {useLeaveGuard,confirmLeave} from '../../apps/shop/src/leave-guard';
import {submitOnShortcut} from '../../apps/shop/src/submit-shortcut';
import './style.css';
export const siteApi:ApiClient=async(path,data,options)=>{
 path=path.replace(/^\/api\/shops\/finder\/(?:images|menu-images)/,'/api/site/images');
 const response=await fetch(path,{method:data===undefined?'GET':'POST',headers:data===undefined?{}:{'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data),signal:options?.signal});
 const result=await response.json();if(!response.ok)throw Error(result.error||`HTTP ${response.status}`);return result;
};
type Item={id:string;at:string|null;summary:string[];request?:string;baseRevision?:string;appliedAt?:string;imageIds?:string[]};
type State={revision:string;configured:boolean;published:Item;versions:Item[];proposals:Item[];publicUrl:string;proposal?:Item;message?:string};
type Media={mimeType:'image/png';data:string};
type Proposal={before:Item;after:Item;media:Media;imageIds:string[]};
/** Where a saved version is previewed; Storybook replaces it with a static page. */
export const PreviewUrl=createContext((id:string)=>`/api/site/preview?source=${encodeURIComponent(id)}`);
function Preview({item,width,title='お店さがしの変更プレビュー'}:{item:Item;width:number;title?:string}){
 const box=useRef<HTMLDivElement>(null),url=useContext(PreviewUrl),[factor,setFactor]=useState(1);
 useLayoutEffect(()=>{const observer=new ResizeObserver(()=>setFactor(Math.min(1,(box.current?.clientWidth||width)/width)));observer.observe(box.current!);return()=>observer.disconnect();},[width]);
 return <div ref={box} className="finder-preview" style={{height:1000*factor}}><iframe title={title} sandbox="" referrerPolicy="no-referrer" src={url(item.id)} style={{width,height:1000,transform:`scale(${factor})`}}/></div>;
}
export function FinderEditor({api=siteApi}:{api?:ApiClient}){
 const [state,setState]=useState<State>(),[selected,setSelected]=useState<Item>(),[error,setError]=useState(''),[notice,setNotice]=useState(''),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[work,setWork]=useState(''),[width,setWidth]=useState(1280),[instruction,setInstruction]=useState(''),[imageIds,setImageIds]=useState<string[]>([]),[image,setImage]=useState(''),[marked,setMarked]=useState(false),[proposal,setProposal]=useState<Proposal>(),[listening,setListening]=useState(false),[history,setHistory]=useState<Item[]>([]),[index,setIndex]=useState(0),[version,setVersion]=useState('');
 const canvas=useRef<HTMLCanvasElement>(null),owned=useRef(false),stopDictation=useRef<(()=>void)|null>(null),log=useRef<HTMLDivElement>(null),chat=useChatPanelCollapse(true,'画面の修正');
 const editable=!!state&&!!selected&&(!selected.baseRevision||selected.baseRevision===state.revision&&!selected.appliedAt);
 const dirty=!!selected&&selected.id!==state?.published.id;
 useLeaveGuard(busy?'AIが画面を修正しています。移動しますか？':proposal?'AIの修正案をまだ「OK」で取り込んでいません。移動しますか？':dirty?'編集中の内容はまだ公開していません。管理画面に戻りますか？':undefined);
 useEffect(()=>{let alive=true;api<{user?:unknown}>('/api/session').then(s=>{if(!s.user){location.replace('/');return;}return api<State>('/api/site');}).then(value=>{if(value&&alive){setState(value);setSelected(value.published);setHistory([value.published]);setVersion(value.published.id);}}).catch(e=>{if(alive)setError(e.message);}).finally(()=>{if(alive)setLoading(false);});return()=>{alive=false;};},[]);
 useEffect(()=>{document.body.classList.toggle('visual-chat-open',chat.expanded);return()=>document.body.classList.remove('visual-chat-open');},[chat.expanded]);
 useEffect(()=>{if(log.current)log.current.scrollTop=log.current.scrollHeight;},[state?.proposals,error,busy]);
 useEffect(()=>{if(!image)return;let alive=true;const img=new Image();img.onload=()=>{if(!alive||!canvas.current)return;canvas.current.width=img.width;canvas.current.height=img.height;canvas.current.getContext('2d')!.drawImage(img,0,0);setMarked(false);};img.src=image;return()=>{alive=false;};},[image]);
 async function run(fn:()=>Promise<void>){if(owned.current)return;owned.current=true;setBusy(true);setError('');try{await fn();}catch(e){setError(e instanceof Error?e.message:String(e));}finally{owned.current=false;setBusy(false);setWork('');}}
 function clearCapture(){setImage('');setMarked(false);}
 function choose(item:Item,remember=true){setSelected(item);clearCapture();if(remember){const next=[...history.slice(0,index+1),item];setHistory(next);setIndex(next.length-1);}}
 async function capture(){if(!state||!selected)return;setWork('画面を取り込んでいます…');const media=await api<Media>('/api/site/capture',{sourceId:selected.id,revision:state.revision,width});return media;}
 async function pen(){chat.expand();await run(async()=>{const media=await capture();if(media)setImage(`data:${media.mimeType};base64,${media.data}`);});}
 async function generate(request:string,source:Item,media:Media,ids:string[]){if(!state)return;setWork('AIが修正案を作成しています…');const result=await api<State>('/api/site/proposals',{request,revision:state.revision,sourceId:source.id,media,imageIds:ids});setState(result);return result.proposal;}
 async function send(text=instruction){if(!editable||!text.trim()||!state||!selected||busy)return;stopDictation.current?.();await run(async()=>{
  const media=image&&canvas.current?{mimeType:'image/png' as const,data:canvas.current.toDataURL('image/png').split(',')[1]}:await capture();if(!media)return;
  const after=await generate(text.trim(),selected,media,imageIds);if(after){setProposal({before:selected,after,media,imageIds:[...imageIds]});setInstruction('');}
 });}
 function adopt(){if(!proposal)return;choose(proposal.after);setProposal(undefined);setImageIds([]);setNotice('画面を更新しました。まだ公開していません。');}
 async function publish(){if(!state||!selected||!editable)return;await run(async()=>{setWork('公開しています…');const result=await api<State>('/api/site/publish',{sourceId:selected.id,revision:state.revision});setState(result);choose(result.published,false);setHistory([result.published]);setIndex(0);setVersion(result.published.id);setNotice(result.message||'お店さがしに反映しました。');});}
 if(loading)return <main className="finder-editor"><p role="status">読み込んでいます…</p></main>;
 if(!state||!selected)return <main className="finder-editor"><p role="alert">{error||'管理画面からログインしてください。'}</p><a href="/">管理画面へ</a></main>;
 const versions=state.versions.length?state.versions:[state.published];
 return <>
  <main className="finder-editor">
   <div className="finder-toolbar editor-toolbar"><a href="/" onClick={e=>{if(!confirmLeave())e.preventDefault();}}>← 運営管理</a><h1>お店さがしのページ</h1><div className="editor-tools"><button type="button" aria-pressed={width===1280} disabled={busy} onClick={()=>{setWidth(1280);clearCapture();}}>PC</button><button type="button" aria-pressed={width===390} disabled={busy} onClick={()=>{setWidth(390);clearCapture();}}>スマホ</button><button className="primary" disabled={busy||!dirty||!editable||!!proposal} onClick={()=>void publish()}>{selected.baseRevision?'この内容を反映する':dirty?'この版に戻す':'公開中'}</button></div></div>
   <p id="site-design-selection" className="small muted">{selected.id===state.published.id?'公開中の内容':selected.baseRevision?'編集中 · 未公開':'履歴から選んだ内容 · 未公開'}</p>
   {notice&&<p className="notice" role="status">{notice}</p>}{error&&<p className="alert" role="alert">{error}</p>}
   <div className="finder-page-preview" style={{maxWidth:width}}>{image?<div className="visual-request"><AnnotationCanvas canvasRef={canvas} disabled={busy} onMark={()=>setMarked(true)}/><button type="button" disabled={busy||!marked} onClick={()=>{const old=image;setImage('');requestAnimationFrame(()=>setImage(old));}}>印を消して描き直す</button></div>:<Preview item={selected} width={width}/>}</div>
   <details className="design-version-history"><summary>公開した履歴・変更案</summary><label>公開した履歴<select aria-label="公開した履歴" value={version} disabled={busy} onChange={e=>setVersion(e.target.value)}>{versions.map(v=><option key={v.id} value={v.id}>{v.id===state.published.id?'公開中 · ':''}{v.at?new Date(v.at).toLocaleString('ja-JP'):'最初のデザイン'} · {v.summary.join('、')}</option>)}</select></label><button disabled={busy} onClick={()=>{const item=versions.find(v=>v.id===version);if(item)choose(item);}}>選んだ版を確認する</button><button disabled={busy} onClick={()=>void run(async()=>{const latest=await api<State>('/api/site');setState(latest);choose(latest.published);})}>公開中の内容から始める</button>
    <ul className="design-version-list">{state.proposals.map(p=><li key={p.id}><span>{p.request}</span><button disabled={busy||!!p.appliedAt||p.baseRevision!==state.revision} onClick={()=>choose(p)}>この変更案を見る</button></li>)}</ul>
   </details><p className="small muted">「OK」は編集中の内容への採用です。「この内容を反映する」を押すと公開します。<a href={state.publicUrl} target="_blank" rel="noopener noreferrer">公開ページを見る ↗</a></p>
  </main>
  {chat.restoreButton}
  <aside id={chat.panelId} tabIndex={-1} hidden={!chat.expanded} className="visual-chat-panel" aria-label="画面の修正チャット">
   <div className="visual-chat-heading"><div><h3>画面の修正</h3><p className="small muted">お店さがしのページ</p></div><div className="chat-panel-heading-actions">{chat.collapseButton}</div></div>
   <p className="small">赤ペンで囲むか、変えたいことをそのまま書いてください。</p>
   <div className="visual-chat-view"><div className="visual-edit-history" role="group" aria-label="修正履歴"><button aria-label="前の状態に戻る" disabled={busy||index===0} onClick={()=>{setIndex(index-1);choose(history[index-1],false);}}>← 戻る</button><span>{index+1} / {history.length}</span><button aria-label="次の状態に進む" disabled={busy||index===history.length-1} onClick={()=>{setIndex(index+1);choose(history[index+1],false);}}>進む →</button></div><button disabled={busy||!editable} onClick={()=>image?clearCapture():void pen()}>{image?'画面を操作する':'赤ペンで囲む'}</button></div>
   <div ref={log} className="chat-log visual-chat-log" role="log" aria-label="画面の修正の会話">{[...state.proposals].reverse().map(p=><React.Fragment key={p.id}><article className="chat-message chat-message-user"><b>あなた</b><div className="pre-wrap">{p.request}</div>{!!p.imageIds?.length&&<div className="chat-message-images">{p.imageIds.map((id,i)=><MenuImage key={id} imageId={id} imageBase="/api/site/images" name={`添付画像${i+1}`} className="chat-message-image"/>)}</div>}</article><article className="chat-message chat-message-assistant"><b>Gemini</b><div className="pre-wrap">{p.summary.join('\n')}</div></article></React.Fragment>)}{!state.proposals.length&&<p className="small muted">例：見出しを変えたい、写真をここに置きたい、もっと明るい色にしたい。</p>}</div>
   {busy&&<p role="status" className="small"><span className="image-upload-spinner" aria-hidden="true"/>{work||'確認しています…'}</p>}
   {!state.configured&&<p role="alert">管理サーバーにGeminiのAPIキーを設定してください。</p>}
   <form className="chat-composer" aria-label="ペンで囲んだ箇所への依頼" onSubmit={e=>{e.preventDefault();void send();}}><textarea aria-label="ここをどう変えたいですか" aria-keyshortcuts="Control+Enter Meta+Enter" onKeyDown={e=>submitOnShortcut(e)} rows={3} maxLength={4000} disabled={busy||!editable} value={instruction} onChange={e=>setInstruction(e.target.value)} placeholder="ここを『街のお店との出会いを、ここから』に変えて"/><div className="chat-composer-toolbar"><RequestImagePicker shopId="finder" value={imageIds} onChange={setImageIds} disabled={busy||listening} label="画像を添付" allowGeneration={false} uploadLimitMb={10}/><DictationButton value={instruction} onChange={setInstruction} onListening={setListening} onSend={text=>void send(text)} stopRef={stopDictation} disabled={busy}/><button className="primary chat-send" type="submit" disabled={busy||listening||!editable||!state.configured||!instruction.trim()}>送信</button></div></form>
  </aside>
  {proposal&&<VisualChangeReview before={<Preview item={proposal.before} width={width} title="変更前のプレビュー"/>} after={<Preview item={proposal.after} width={width} title="修正案のプレビュー"/>} summary={proposal.after.summary} busy={busy} error={error} onAccept={adopt} onCancel={()=>{setProposal(undefined);setNotice('修正案をキャンセルしました。変更前の内容を保持しています。');}} onRefine={async text=>{let success=false;await run(async()=>{const after=await generate(text,proposal.after,proposal.media,proposal.imageIds);if(after){setProposal({...proposal,after});success=true;}});return success;}}/>}
 </>;
}
