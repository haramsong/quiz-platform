import { useState } from 'react';

// Confirm modal.
// mode="delete": requires typing the code exactly.
// mode="reset": simple confirm, with optional force when running.
export default function ConfirmModal({ mode, code, onCancel, onConfirm, busy }) {
  const [typed, setTyped] = useState('');
  const [force, setForce] = useState(false);

  const isDelete = mode === 'delete';
  const canConfirm = isDelete ? typed === code : true;

  return (
    <div className="modal-backdrop" onClick={busy ? undefined : onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{isDelete ? '퀴즈 삭제' : '데이터 초기화'}</h3>
        {isDelete ? (
          <>
            <p>
              <strong>{code}</strong> 퀴즈의 모든 데이터(문제·참가자·점수·이미지)를
              영구 삭제합니다. 되돌릴 수 없습니다.
            </p>
            <p className="muted">확인을 위해 코드를 그대로 입력하세요:</p>
            <input
              autoFocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={code}
            />
          </>
        ) : (
          <>
            <p>
              <strong>{code}</strong> 의 참가자·점수·응답·진행 상태를 초기화합니다.
              문제와 설정은 유지됩니다.
            </p>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={force}
                onChange={(e) => setForce(e.target.checked)}
              />
              진행 중(RUNNING)이어도 강제 초기화 (force)
            </label>
          </>
        )}
        <div className="modal-actions">
          <button className="btn ghost" onClick={onCancel} disabled={busy}>
            취소
          </button>
          <button
            className={`btn ${isDelete ? 'danger' : 'warn'}`}
            disabled={!canConfirm || busy}
            onClick={() => onConfirm({ force })}
          >
            {busy ? '처리 중…' : isDelete ? '삭제' : '초기화'}
          </button>
        </div>
      </div>
    </div>
  );
}
