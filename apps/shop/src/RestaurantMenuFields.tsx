import { tr } from "../shared/i18n";
import { getLocale } from "../shared/i18n";
import React, { useState } from "react";
import { allergenIds, menuKinds, type ShopConfig } from "../server/domain";
import { allergenLabels } from "../shared/allergens";

type Menu = ShopConfig["menus"][number];
/** What a restaurant records for a course, dish or drink: its kind, what it is made of, and for a course who can order it. */
export function RestaurantMenuFields({ menu, onChange: change }: { menu: Menu; onChange: (menu: Menu) => void }) {
  const [draft, setDraft] = useState("");
  const ingredients = menu.ingredients || [];
  const kind = menu.kind || "course";
  // An item that arrived without a kind shows as a course, so any edit here stores that kind with it.
  const onChange = (next: Menu) => change({ ...next, kind: next.kind || kind });
  const kindLabel = { course: tr("コース（予約で選べる）"), dish: tr("料理"), drink: tr("飲み物") };
  const add = () => {
    const words = draft.split(/[,、\n]+/).map(word => word.trim().slice(0, 40)).filter(word => word && !ingredients.includes(word));
    if (words.length) onChange({ ...menu, ingredients: [...ingredients, ...words].slice(0, 60) });
    setDraft("");
  };
  const optional = (key: "minPeople" | "maxPeople" | "courseMinutes", value: string) => {
    const { [key]: _removed, ...rest } = menu;
    onChange(value === "" ? rest : { ...menu, [key]: +value });
  };
  return <fieldset className="restaurant-menu-fields">
    <legend>{tr("種別と材料")}</legend>
    <div className="edit-row">
      <label className="field"><span>{tr("種別")}</span><select value={kind} onChange={event => onChange({ ...menu, kind: event.target.value as NonNullable<Menu["kind"]> })}>
        {menuKinds.map(value => <option key={value} value={value}>{kindLabel[value]}</option>)}
      </select></label>
      {kind === "course" && <>
        <label className="field"><span>{tr("人数（下限・任意）")}</span><input type="number" min={1} max={200} value={menu.minPeople ?? ""} onChange={event => optional("minPeople", event.target.value)} /></label>
        <label className="field"><span>{tr("人数（上限・任意）")}</span><input type="number" min={1} max={200} value={menu.maxPeople ?? ""} onChange={event => optional("maxPeople", event.target.value)} /></label>
        <label className="field"><span>{tr("利用時間（分・任意）")}</span><input type="number" min={30} max={360} step={15} value={menu.courseMinutes ?? ""} onChange={event => optional("courseMinutes", event.target.value)} /></label>
      </>}
    </div>
    <p className="small muted">{kind === "course" ? tr("料金は1人あたりです。利用時間を空欄にすると、席の設定の利用時間を使います。") : tr("料理と飲み物は予約では選べません。材料の問い合わせに答えるための情報です。")}</p>
    <div className="field"><span>{tr("材料（必須）")}</span>
      <ul className="ingredient-tags" aria-label={tr("材料")}>{ingredients.map(word => <li key={word}>{word}<button type="button" aria-label={tr("{0} を外す", word)} onClick={() => {
        const next = ingredients.filter(other => other !== word);
        const { ingredients: _removed, ...rest } = menu;
        onChange(next.length ? { ...menu, ingredients: next } : rest);
      }}>×</button></li>)}</ul>
      <div className="edit-row"><input aria-label={tr("材料を追加")} value={draft} maxLength={200} placeholder={tr("例：えび、塩（カンマ区切りでまとめて追加できます）")} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); add(); } }} onBlur={add} />
        <button type="button" onClick={add}>{tr("材料を追加")}</button></div>
    </div>
    {menu.active && !ingredients.length && <p className="alert" role="alert">{tr("材料を1つ以上入力してください。")}</p>}
    <div className="field"><span>{tr("アレルゲン（特定原材料8品目）")}</span>
      <div className="checkboxes">{allergenIds.map(id => <label key={id}><input type="checkbox" checked={!!menu.allergens?.includes(id)} onChange={event => onChange({ ...menu, allergens: event.target.checked ? [...(menu.allergens || []), id] : (menu.allergens || []).filter(other => other !== id) })} />{allergenLabels[id][getLocale()]}</label>)}</div>
    </div>
    <label className="field"><span>{tr("アレルゲンの注記（任意）")}</span><input value={menu.allergenNote || ""} maxLength={300} placeholder={tr("例：同じ厨房でえびを扱います。")} onChange={event => { const { allergenNote: _removed, ...rest } = menu; onChange(event.target.value ? { ...menu, allergenNote: event.target.value } : rest); }} /></label>
  </fieldset>;
}
