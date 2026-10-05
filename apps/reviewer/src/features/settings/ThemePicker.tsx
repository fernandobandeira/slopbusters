import { Palette } from 'lucide-react'
import { useReviewerTheme } from '../../app/ThemeProvider'
import { isThemeId, themes } from '../../lib/themes'

export function ThemePicker() {
  const { themeId, setTheme, error } = useReviewerTheme()
  return (
    <div className="theme-control">
      <label className="theme-picker">
        <Palette size={16} aria-hidden="true" />
        <span>Theme</span>
        <select
          aria-label="Color theme"
          value={themeId}
          onChange={(event) => {
            if (isThemeId(event.target.value)) setTheme(event.target.value)
          }}
        >
          {(['dark', 'light'] as const).map((type) => (
            <optgroup key={type} label={type === 'dark' ? 'Dark themes' : 'Light themes'}>
              {themes
                .filter((theme) => theme.type === type)
                .map((theme) => (
                  <option key={theme.id} value={theme.id}>
                    {theme.name}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
      </label>
      {error && (
        <span className="theme-error" role="status" title={error}>
          {error}
        </span>
      )}
    </div>
  )
}
