import React, { useEffect, useRef } from "react";
import Icon from "./Icon";
export default function Modal({ title, children, onClose, wide = false }) {
  const ref = useRef(null);
  useEffect(() => {
    const before = document.activeElement;
    ref.current?.focus();
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = old;
      before?.focus();
    };
  }, []);
  const keys = (e) => {
    if (e.key === "Escape") onClose();
    if (e.key === "Tab") {
      // Приховані поля закритого details не беруть участі в обході фокусу.
      const els = [
        ...ref.current.querySelectorAll(
          "button,input,select,textarea,a[href],summary,[tabindex]",
        ),
      ].filter((x) => !x.disabled && x.tabIndex >= 0 && x.getClientRects().length);
      if (!els.length) return;
      const first = els[0],
        last = els.at(-1);
      if (e.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) {
        e.preventDefault();
        last.focus();
      }
      if (!e.shiftKey && (document.activeElement === last || document.activeElement === ref.current)) {
        e.preventDefault();
        first.focus();
      }
    }
  };
  return (
    <div
      className="overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        className={"modal " + (wide ? "wide" : "")}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        tabIndex={-1}
        ref={ref}
        onKeyDown={keys}
      >
        <header>
          <h2 id="modal-title">{title}</h2>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label="Закрити"
          >
            <Icon name="close" />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
