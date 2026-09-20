import { TestBed } from '@angular/core/testing';

import { HubModal } from './modal';

/**
 * A dialog there is no free way out of.
 *
 * The header's dismiss button was always drawn, so a consumer that could not offer it —
 * a setup wizard that provisions the company's defaults on its way out and says so on the
 * button that does it — hid it with a CSS rule of its own. Hiding is not removing: the
 * button stayed in the DOM, where a screen reader still announces it and the tab order
 * still reaches it.
 */
describe('the header dismiss button', () => {
	afterEach(() => {
		document.querySelectorAll('hub-modal-window, hub-modal-backdrop').forEach((el) => el.remove());
	});

	const open = (closeButton?: boolean) =>
		TestBed.inject(HubModal).open('Content', {
			animation: false,
			closeButton,
			// Slotted content, so the window draws its own header rather than the body alone.
			headerSelector: '[data-modal-header]'
		});

	it('is drawn by default', () => {
		open().result.catch(() => {});

		expect(document.querySelector('.hub-modal__close')).not.toBeNull();
	});

	it('is left out of the DOM, not hidden, when the dialog refuses it', () => {
		open(false).result.catch(() => {});

		expect(document.querySelector('.hub-modal__close')).toBeNull();
	});
});
