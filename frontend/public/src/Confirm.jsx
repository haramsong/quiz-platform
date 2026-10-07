import { createContext, useContext, useState, useCallback, useRef } from 'react';

const ConfirmCtx = createContext(null);

export function ConfirmProvider({ children }) {
  const [dialog, setDialog] = useState(null); // { title, message, confirmText, cancelText, danger }
  const resolver = useRef(null);

  const ask = useCallback((opts = {}) => {
    setDialog({
      title: opts.title || '확인',
      message: opts.message || '',
      confirmText: opts.confirmText || '확인',
      cancelText: opts.cancelText || '취소',
      danger: !!opts.danger,
    });
    return new Promise((resolve) => { resolver.current = resolve; });
  }, []);

  const close = useCallback((result) => {
    setDialog(null);
    if (resolver.current) { resolver.current(result); resolver.current = null; }
  }, []);

  return (
    <ConfirmCtx.Provider value={{ ask }}>
      {children}
      {dialog && (
        <div className="confirm-backdrop" onClick={() => close(false)}>
          <div className="confirm-box" onClick={(e) => e.stopPropagation()}>
            <h3 className="confirm-title">{dialog.title}</h3>
            <p className="confirm-msg">{dialog.message}</p>
            <div className="confirm-actions">
              <button className="btn ghost" onClick={() => close(false)}>{dialog.cancelText}</button>
              <button className={`btn ${dialog.danger ? 'danger' : 'primary'}`} autoFocus onClick={() => close(true)}>
                {dialog.confirmText}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmCtx.Provider>
  );
}

export function useConfirm() {
  const ctx = useContext(ConfirmCtx);
  return ctx || { ask: async () => window.confirm('계속할까요?') };
}
