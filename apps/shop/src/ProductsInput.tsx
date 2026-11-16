import { useEffect, useState } from "react";

const names = (text: string) => text.split("\n").map(value => value.trim()).filter(Boolean);

/** Keep newlines while editing; settings always receive valid nonempty names. */
export function ProductsInput({ value, onChange }: { value?: string[]; onChange: (names: string[]) => void }) {
  const saved = JSON.stringify(value || []);
  const [text, setText] = useState(() => (value || []).join("\n"));
  useEffect(() => {
    setText(current => JSON.stringify(names(current)) === saved ? current : (JSON.parse(saved) as string[]).join("\n"));
  }, [saved]);
  return <textarea value={text} onChange={event => {
    const next = names(event.target.value);
    if (next.length > 50 || next.some(name => name.length > 100)) return;
    setText(event.target.value);
    onChange(next);
  }} />;
}
