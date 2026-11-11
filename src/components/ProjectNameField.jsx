import { useId } from 'react';
import { PROJECT_NAME_MAX } from '../lib/project-library.js';

export function ProjectNameField({ value, onChange, onCommit, className = '' }) {
  const id = useId();
  return (
    <div className={`project-name ${className}`.trim()}>
      <label className="project-name__label" htmlFor={id}>
        Project name
      </label>
      <input
        id={id}
        className="project-name__input"
        data-testid="project-name-input"
        type="text"
        value={value}
        maxLength={PROJECT_NAME_MAX}
        autoComplete="off"
        spellCheck="false"
        enterKeyHint="done"
        onChange={(event) => onChange(event.target.value)}
        onBlur={onCommit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
      />
    </div>
  );
}
