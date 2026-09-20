import { TestBed } from '@angular/core/testing';

import { HubModal } from './modal';

/**
 * A dialog opened over another.
 *
 * Every dialog was painted at the same height and so was every backdrop, so the second
 * backdrop landed under the first dialog: the new one floated over a page that was not
 * dimmed, and what it covered still looked reachable. Consumers were writing sibling
 * selectors by hand to lift the second level, which covers two and fails silently at three.
 */
describe('stacked dialogs', () => {
	afterEach(() => {
		document.querySelectorAll('hub-modal-window, hub-modal-backdrop').forEach((el) => el.remove());
	});

	const open = () => TestBed.inject(HubModal).open('Content', { animation: false });

	/** The pair of elements a dialog paints, in the order they were attached. */
	const painted = () => ({
		windows: [...document.querySelectorAll<HTMLElement>('hub-modal-window')],
		backdrops: [...document.querySelectorAll<HTMLElement>('hub-modal-backdrop')]
	});

	it('leaves the first dialog exactly where the application themed it', () => {
		open().result.catch(() => {});

		const { windows, backdrops } = painted();

		// Nothing written inline: an application that moved `--hub-modal-zindex` keeps it.
		expect(windows[0].style.getPropertyValue('--hub-modal-zindex')).toBe('');
		expect(backdrops[0].style.getPropertyValue('--hub-modal-backdrop-zindex')).toBe('');
	});

	it('lifts the second dialog over the first, and its backdrop between the two', () => {
		open().result.catch(() => {});
		open().result.catch(() => {});

		const { windows, backdrops } = painted();

		expect(windows[1].style.getPropertyValue('--hub-modal-zindex')).toContain('+ 2');
		// One below its own dialog and one above the dialog underneath, which is the whole
		// point: the backdrop has to sit between the two.
		expect(backdrops[1].style.getPropertyValue('--hub-modal-backdrop-zindex')).toContain('+ 1');
	});

	it('keeps climbing past the second level', () => {
		open().result.catch(() => {});
		open().result.catch(() => {});
		open().result.catch(() => {});

		const { windows, backdrops } = painted();

		expect(windows[2].style.getPropertyValue('--hub-modal-zindex')).toContain('+ 4');
		expect(backdrops[2].style.getPropertyValue('--hub-modal-backdrop-zindex')).toContain('+ 3');
	});
});
