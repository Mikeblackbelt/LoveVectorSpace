import { fireEvent, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { Shell } from '../components/Shell';
import { renderAt, useMockApi } from '../test/utils';
import { FormsScreen } from './Forms';

beforeEach(() => useMockApi());

function FormsRoute() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route path="/p/:pid/forms" element={<FormsScreen />} />
      </Route>
    </Routes>
  );
}

async function scaleRow(name: string): Promise<HTMLElement> {
  const hits = await screen.findAllByText(name);
  const row = hits.map((el) => el.closest('li.scale-row')).find(Boolean);
  if (!row) throw new Error(`no scale row for ${name}`);
  return row as HTMLElement;
}

describe('questionnaires', () => {
  it('shows overlay placeholders, never published item wording, and stays usable', async () => {
    const { container } = renderAt(<FormsRoute />, { route: '/p/2/forms' });
    const row = await scaleRow('Couples Satisfaction Index (CSI-4)');
    expect(row.textContent).toContain('[OVERLAY]');
    fireEvent.click(within(row).getByRole('button'));
    expect(await screen.findByText('Item 1 (text from local overlay)')).toBeTruthy();
    expect(screen.getByText('Item 4 (text from local overlay)')).toBeTruthy();
    expect(container.textContent).not.toMatch(/degree of happiness|warm and comfortable/i);
    expect(screen.getAllByRole('radiogroup')).toHaveLength(4);
  });

  it('tags custom scales as unverified and custom', async () => {
    renderAt(<FormsRoute />, { route: '/p/1/forms' });
    const row = await scaleRow('Reciprocity check');
    expect(row.textContent).toContain('[UNVERIFIED]');
    expect(row.textContent).toContain('[CUSTOM]');
  });
});
