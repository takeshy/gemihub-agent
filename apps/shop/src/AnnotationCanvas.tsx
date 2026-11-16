import React, {useRef} from 'react';
import {tr} from '../shared/i18n';
/** Shared red-pen surface for storefront and finder editing; coordinates follow the image pixels. */
export function AnnotationCanvas({canvasRef, disabled, onMark}: {canvasRef: React.RefObject<HTMLCanvasElement|null>; disabled?: boolean; onMark:()=>void}) {
 const drawing=useRef(false);
 return <canvas ref={canvasRef} aria-label={tr('変更したい箇所を囲む画面')} className="annotation-canvas"
  onPointerDown={event=>{if(disabled)return;event.preventDefault();event.currentTarget.setPointerCapture(event.pointerId);drawing.current=true;
   const rect=event.currentTarget.getBoundingClientRect(),ctx=event.currentTarget.getContext('2d')!;ctx.beginPath();ctx.strokeStyle='#e32236';ctx.lineWidth=5;ctx.lineCap='round';ctx.moveTo((event.clientX-rect.left)*event.currentTarget.width/rect.width,(event.clientY-rect.top)*event.currentTarget.height/rect.height);onMark();}}
  onPointerMove={event=>{if(!drawing.current||disabled)return;const rect=event.currentTarget.getBoundingClientRect(),ctx=event.currentTarget.getContext('2d')!;ctx.lineTo((event.clientX-rect.left)*event.currentTarget.width/rect.width,(event.clientY-rect.top)*event.currentTarget.height/rect.height);ctx.stroke();}}
  onPointerUp={()=>{drawing.current=false;}} onPointerCancel={()=>{drawing.current=false;}}/>;
}
