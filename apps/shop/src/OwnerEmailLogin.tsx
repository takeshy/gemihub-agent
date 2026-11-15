import React, { useEffect, useState } from "react";
import { tr } from "../shared/i18n";
import { useApi } from "./api";

export function OwnerEmailLogin({ token = "" }: { token?: string }) {
  const api = useApi();
  const [email, setEmail] = useState("");
  const [industry, setIndustry] = useState("other");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!token) return;
    history.replaceState(null, "", location.pathname + location.search);
    api<{ email: string }>("/api/owner-login/info", { token }).then(info => { setEmail(info.email); setReady(true); }).catch(error => setError(error.message));
  }, [token]);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      if (token) { await api("/api/owner-login/verify", { token }); location.assign("/"); }
      else { await api("/api/owner-login", { email, industry }); setNotice(tr("メールを送りました。届いたリンクからログインしてください。")); }
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  }
  return <section className="panel owner-email-login" aria-label={tr("メールリンクでお店を管理")}>
    <h2>{tr("メールリンクでお店を管理")}</h2>
    {error && <p className="error" role="alert">{error}</p>}
    {notice ? <p className="notice" role="status">{notice}</p> : <form onSubmit={submit}>
      {token ? <p>{tr("{0} としてお店の管理にログインします。", email)}</p> : <>
        <p>{tr("飲食店・その他のお店は、Googleアカウントなしで始められます。")}</p>
        <label className="field">{tr("メールアドレス")}<input type="email" autoComplete="email" required maxLength={254} value={email} onChange={event => setEmail(event.target.value)} disabled={busy}/></label>
        <label className="field">{tr("お店の種類")}<select value={industry} onChange={event => setIndustry(event.target.value)} disabled={busy}><option value="other">{tr("その他のお店")}</option><option value="restaurant">{tr("飲食店")}</option></select></label>
      </>}
      <button className="button primary" disabled={busy || !!token && !ready}>{token ? tr("このメールアドレスでログイン") : tr("ログイン用メールを送る")}</button>
    </form>}
    <p className="small muted">{tr("ネイル・美容室などのサロンはGoogleでログインしてください。")}</p>
    <a className="button" href="/auth/google">{tr("Googleでログイン")}</a>
  </section>;
}
