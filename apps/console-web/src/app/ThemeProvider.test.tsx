import { Button } from '@blueprintjs/core';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import { ThemeProvider, useTheme } from './ThemeProvider.js';

function Fixture(): React.JSX.Element {
  const { theme, setTheme } = useTheme();
  return <Button text={theme} onClick={() => setTheme('light')} />;
}

describe('ThemeProvider', () => {
  beforeEach(() => window.localStorage.clear());

  it('defaults dark and stores only the selected theme', async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <Fixture />
      </ThemeProvider>,
    );
    expect(screen.getByRole('button', { name: 'dark' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'dark' }));
    expect(window.localStorage.getItem('mymcp-console-theme')).toBe('light');
    expect(window.localStorage).toHaveLength(1);
  });
});
