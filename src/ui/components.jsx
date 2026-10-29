import React, { useEffect, useRef, useState } from 'react';

export function Button({ children, kind = '', className = '', ...props }) {
  return <button type="button" className={`button ${kind} ${className}`} {...props}>{children}</button>;
}
export function NumberField({ label, value, onChange, step = 'any', min, max, suffix, disabled = false, hint }) {
  const [text, setText] = useState(value == null ? '' : String(value));
  const [invalid, setInvalid] = useState(false);
  useEffect(() => { setText(value == null ? '' : String(value)); setInvalid(false); }, [value]);
  function commit() {
    const number = Number(text);
    if (!text.trim() || !Number.isFinite(number) || (min !== undefined && number < min) || (max !== undefined && number > max)) { setInvalid(true); return; }
    setInvalid(false);
    if (number !== value && onChange(number) === false) setInvalid(true);
  }
  return <label className={`field ${invalid ? 'field-error' : ''}`}>
    <span>{label}{suffix && <small>{suffix}</small>}</span>
    <input type="number" inputMode="decimal" value={text} step={step} min={min} max={max} disabled={disabled} aria-label={label} aria-invalid={invalid} onChange={event => setText(event.target.value)} onBlur={commit} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} />
    {invalid ? <small className="error-text">此值未应用，请检查数值范围与配置约束。</small> : hint && <small className="muted">{hint}</small>}
  </label>;
}
export function TextField({ label, children, hint, ...props }) {
  const controls = children ? React.Children.map(children, child => React.isValidElement(child) && ['input', 'textarea', 'select'].includes(child.type) ? React.cloneElement(child, { 'aria-label': child.props['aria-label'] || label }) : child) : <input {...props} aria-label={props['aria-label'] || label} />;
  return <label className="field"><span>{label}</span>{controls}{hint && <small className="muted">{hint}</small>}</label>;
}
export function Status({ value, children }) {
  const names = { pass: '达标', fail: '未达标', unknown: '无法判定', completed: '计算完成', invalid: '输入无效', unstable: '闭环不稳定', numerical_error: '计算异常' };
  return <span className={`status status-${value || 'unknown'}`}>{children || names[value] || value || '尚未计算'}</span>;
}
export function Empty({ title, children, action }) {
  return <div className="empty"><h3>{title}</h3>{children && <p>{children}</p>}{action}</div>;
}
export function Modal({ title, children, onClose, wide = false }) {
  const dialog = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    const focusable = () => [...(dialog.current?.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]') || [])].filter(node => node.getClientRects().length);
    focusable()[0]?.focus();
    function close(event) {
      if (event.key === 'Escape') onClose();
      if (event.key !== 'Tab') return;
      const items = focusable(); if (!items.length) return;
      if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items.at(-1).focus(); }
      if (!event.shiftKey && document.activeElement === items.at(-1)) { event.preventDefault(); items[0].focus(); }
    }
    document.addEventListener('keydown', close);
    return () => { document.removeEventListener('keydown', close); previous?.focus?.(); };
  }, [onClose]);
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialog} className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
      <header><h2>{title}</h2><Button onClick={onClose} aria-label="关闭对话框">关闭</Button></header>
      {children}
    </section>
  </div>;
}
export function ErrorBoundary({ children }) { return <Boundary>{children}</Boundary>; }
class Boundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (this.state.error) return <div className="fatal-error"><h2>界面遇到错误</h2><p>{this.state.error.message}</p><p>已保存的实验仍保存在本机数据目录中。</p><Button onClick={() => window.location.reload()}>重新打开界面</Button></div>;
    return this.props.children;
  }
}
