import React, { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { tr } from "../shared/i18n";
import { useChatPanelCollapse } from "./ChatPanelCollapse";

/** Shares the red-pen editor's panel, responsive layout and keyboard entry point. */
export function EditingChatPanel({ open, title, onClose, children, reopenSignal = 0 }: {
  open: boolean; title: string; onClose: () => void; children: React.ReactNode; reopenSignal?: number;
}) {
  const panel = useRef<HTMLElement>(null);
  const chat = useChatPanelCollapse(open, title, reopenSignal);
  useEffect(() => {
    if (!chat.expanded) return;
    document.body.classList.add("visual-chat-open", "shop-change-chat-open");
    panel.current?.querySelector<HTMLTextAreaElement>("textarea")?.focus({ preventScroll: true });
    return () => document.body.classList.remove("visual-chat-open", "shop-change-chat-open");
  }, [chat.expanded]);
  useEffect(() => {
    const element = panel.current;
    const viewport = window.visualViewport;
    if (!chat.expanded || !element || !viewport) return;
    const reset = () => {
      element.classList.remove("shop-chat-keyboard-open");
      element.style.removeProperty("--shop-chat-visible-height");
      element.style.removeProperty("--shop-chat-keyboard-inset");
    };
    const update = () => {
      if (viewport.scale > 1.05 || window.innerHeight - viewport.height < 150) {
        reset();
        return;
      }
      // Fixed elements use the layout viewport on mobile browsers such as iOS Safari.
      element.style.setProperty("--shop-chat-visible-height", `${viewport.height}px`);
      element.style.setProperty("--shop-chat-keyboard-inset", `${Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)}px`);
      element.classList.add("shop-chat-keyboard-open");
    };
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
      reset();
    };
  }, [chat.expanded]);
  return <>{chat.restoreButton}{createPortal(<aside id={chat.panelId} tabIndex={-1} ref={panel} hidden={!chat.expanded} className="visual-chat-panel shop-change-chat" aria-label={tr("ページ追加・機能変更のチャット")} onKeyDown={event => { if (event.target instanceof Element && event.target.closest("dialog")) return; if (event.key === "Escape" && !event.nativeEvent.isComposing && !event.defaultPrevented) { event.preventDefault(); event.stopPropagation(); onClose(); } }}>
    <div className="visual-chat-heading"><h3>{title}</h3><div className="chat-panel-heading-actions">{chat.collapseButton}<button type="button" aria-label={tr("閉じる")} onClick={onClose}>×</button></div></div>
    {children}
  </aside>, document.body)}</>;
}
