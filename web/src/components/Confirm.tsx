import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { Modal } from './ui.tsx';

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;
const Ctx = createContext<ConfirmFn>(() => Promise.resolve(false));

/** Диалог подтверждения вместо window.confirm: возвращает промис с решением пользователя. */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((v: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((options) => {
    setState(options);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const close = (value: boolean) => {
    resolver.current?.(value);
    resolver.current = null;
    setState(null);
  };

  return (
    <Ctx.Provider value={confirm}>
      {children}
      {state && (
        <Modal title={state.title} onClose={() => close(false)} narrow>
          <p className="confirm-text">{state.message}</p>
          <div className="form-actions">
            <button className="btn btn-ghost" onClick={() => close(false)}>
              {state.cancelText ?? 'Отмена'}
            </button>
            <button className={`btn ${state.danger ? 'btn-danger' : 'btn-primary'}`} onClick={() => close(true)} autoFocus>
              {state.confirmText ?? 'Подтвердить'}
            </button>
          </div>
        </Modal>
      )}
    </Ctx.Provider>
  );
}

export const useConfirm = () => useContext(Ctx);
