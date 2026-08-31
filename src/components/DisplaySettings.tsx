import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from 'react'
import type { AppThemeId } from '../styles/app-theme'
import { useDisplayPreferences } from '../styles/display-preferences'

const FONT_SCALE_OPTIONS = [85, 90, 95, 100, 105, 110, 115, 120, 125, 130]
const FONT_SCALE_ERROR = '请输入 85–130 之间的整数'

const THEME_OPTIONS: Array<{ id: AppThemeId; label: string }> = [
  { id: 'softResearch', label: '柔和科研' },
  { id: 'coolMinimal', label: '冷色极简' },
  { id: 'warmPaper', label: '暖色纸张' },
]

function closestOptionIndex(value: number): number {
  return FONT_SCALE_OPTIONS.reduce((closestIndex, option, index) => (
    Math.abs(option - value) < Math.abs(FONT_SCALE_OPTIONS[closestIndex] - value)
      ? index
      : closestIndex
  ), 0)
}

/** 提供侧栏内的主题、字号和恢复默认显示设置控件。 */
export default function DisplaySettings() {
  const {
    themeId,
    fontScalePercent,
    setThemeId,
    setFontScalePercent,
    resetDisplayPreferences,
  } = useDisplayPreferences()
  const [isOpen, setIsOpen] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [draftValue, setDraftValue] = useState(String(fontScalePercent))
  const [activeOptionIndex, setActiveOptionIndex] = useState(() => (
    closestOptionIndex(fontScalePercent)
  ))
  const [validationError, setValidationError] = useState('')
  const listboxId = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const shouldRestoreTriggerFocus = useRef(false)

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus()
      inputRef.current?.select()
      return
    }

    if (shouldRestoreTriggerFocus.current) {
      shouldRestoreTriggerFocus.current = false
      triggerRef.current?.focus()
    }
  }, [isEditing])

  const openListbox = (index = closestOptionIndex(fontScalePercent)) => {
    setActiveOptionIndex(index)
    setIsOpen(true)
    setValidationError('')
  }

  const selectFontScale = (value: number) => {
    setFontScalePercent(value)
    setDraftValue(String(value))
    setValidationError('')
    setIsOpen(false)
    triggerRef.current?.focus()
  }

  const startEditing = () => {
    setDraftValue(String(fontScalePercent))
    setValidationError('')
    setIsOpen(false)
    setIsEditing(true)
  }

  const finishEditing = (restoreTriggerFocus: boolean) => {
    const nextValue = Number(draftValue)
    if (
      draftValue.trim() === ''
      || !Number.isInteger(nextValue)
      || nextValue < 85
      || nextValue > 130
    ) {
      setValidationError(FONT_SCALE_ERROR)
      return
    }

    setFontScalePercent(nextValue)
    setDraftValue(String(nextValue))
    setValidationError('')
    shouldRestoreTriggerFocus.current = restoreTriggerFocus
    setIsEditing(false)
  }

  const cancelEditing = () => {
    setDraftValue(String(fontScalePercent))
    setValidationError('')
    shouldRestoreTriggerFocus.current = true
    setIsEditing(false)
  }

  const handleFontKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'F2') {
      event.preventDefault()
      startEditing()
      return
    }

    if (event.key === 'Escape') {
      if (isOpen) {
        event.preventDefault()
        setIsOpen(false)
      }
      return
    }

    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      openListbox(event.key === 'Home' ? 0 : FONT_SCALE_OPTIONS.length - 1)
      return
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const direction = event.key === 'ArrowDown' ? 1 : -1
      const currentIndex = isOpen
        ? activeOptionIndex
        : closestOptionIndex(fontScalePercent)
      const nextIndex = Math.min(
        FONT_SCALE_OPTIONS.length - 1,
        Math.max(0, currentIndex + direction),
      )
      openListbox(nextIndex)
      return
    }

    if (event.key === 'Enter') {
      event.preventDefault()
      if (isOpen) {
        selectFontScale(FONT_SCALE_OPTIONS[activeOptionIndex])
      } else {
        openListbox()
      }
    }
  }

  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      finishEditing(true)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      cancelEditing()
    }
  }

  const handleThemeChange = (event: ChangeEvent<HTMLSelectElement>) => {
    setThemeId(event.target.value as AppThemeId)
  }

  const handleReset = () => {
    shouldRestoreTriggerFocus.current = false
    resetDisplayPreferences()
    setIsOpen(false)
    setIsEditing(false)
    setDraftValue('100')
    setActiveOptionIndex(FONT_SCALE_OPTIONS.indexOf(100))
    setValidationError('')
  }

  return (
    <div className="display-settings">
      <select
        aria-label="界面主题"
        onChange={handleThemeChange}
        title="界面主题"
        value={themeId}
      >
        {THEME_OPTIONS.map((theme) => (
          <option key={theme.id} value={theme.id}>{theme.label}</option>
        ))}
      </select>

      <div className="display-settings__font">
        {isEditing ? (
          <input
            aria-describedby={validationError ? `${listboxId}-error` : undefined}
            aria-invalid={validationError ? 'true' : undefined}
            aria-label="显示字号百分比"
            className="display-settings__font-input"
            max={130}
            min={85}
            onBlur={() => finishEditing(false)}
            onChange={(event) => {
              setDraftValue(event.target.value)
              setValidationError('')
            }}
            onKeyDown={handleInputKeyDown}
            ref={inputRef}
            step={1}
            type="number"
            value={draftValue}
          />
        ) : (
          <button
            aria-activedescendant={isOpen ? `${listboxId}-option-${FONT_SCALE_OPTIONS[activeOptionIndex]}` : undefined}
            aria-controls={listboxId}
            aria-expanded={isOpen}
            aria-haspopup="listbox"
            aria-label="显示字号"
            className="display-settings__font-trigger"
            onBlur={() => setIsOpen(false)}
            onClick={() => {
              if (isOpen) {
                setIsOpen(false)
              } else {
                openListbox()
              }
            }}
            onDoubleClick={startEditing}
            onKeyDown={handleFontKeyDown}
            ref={triggerRef}
            role="combobox"
            title="显示字号；双击或按 F2 手动输入"
            type="button"
          >
            {fontScalePercent}%
          </button>
        )}

        {isOpen && !isEditing ? (
          <div
            aria-label="字号选项"
            className="display-settings__font-listbox"
            id={listboxId}
            role="listbox"
          >
            {FONT_SCALE_OPTIONS.map((value, index) => (
              <div
                aria-selected={fontScalePercent === value}
                className={`display-settings__font-option${index === activeOptionIndex ? ' display-settings__font-option--active' : ''}`}
                id={`${listboxId}-option-${value}`}
                key={value}
                onClick={() => selectFontScale(value)}
                onMouseDown={(event) => event.preventDefault()}
                role="option"
              >
                {value}%
              </div>
            ))}
          </div>
        ) : null}

        {validationError ? (
          <p className="display-settings__error" id={`${listboxId}-error`} role="alert">
            {validationError}
          </p>
        ) : null}
      </div>

      <button
        aria-label="恢复默认显示设置"
        className="display-settings__reset"
        onClick={handleReset}
        title="恢复默认显示设置"
        type="button"
      >
        ↺
      </button>
    </div>
  )
}
