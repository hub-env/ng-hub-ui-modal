import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { HubModal } from './modal';

/** A header made of three nodes: a title, the subtitle under it and a status badge. */
@Component({
	standalone: true,
	template: `
		<div hubModalHeader>
			<h2 class="c-title">Edit customer</h2>
			<p class="c-subtitle">Changes are saved when you press Save.</p>
			<span class="c-badge">Draft</span>
		</div>
		<p class="c-body">Body</p>
	`
})
class MultiNodeHeaderComponent {}

/** Content opened with no slot selectors at all, so the window draws no header. */
@Component({
	standalone: true,
	template: `<p class="c-body">Body</p>`
})
class SingleContentComponent {}

/**
 * The header nodes a caller projects share one box, `.hub-modal__heading`, and the close
 * button sits beside it. That box is what a two-line heading needs: its direction, gap and
 * alignment come from CSS variables and apply to the projected nodes alone, so a subtitle can
 * stack under its title while the button keeps its place at the end of the header.
 */
describe('header heading', () => {
	afterEach(() => {
		document.querySelectorAll('hub-modal-window, hub-modal-backdrop').forEach((el) => el.remove());
	});

	const open = (component: any, options: Record<string, unknown> = {}) =>
		TestBed.inject(HubModal).open(component, { animation: false, ...options });

	const classesOf = (element: Element | null) => Array.from(element?.children ?? []).map((child) => child.className);

	it('puts every projected header node inside the heading, in document order', () => {
		open(MultiNodeHeaderComponent, { headerSelector: '[hubModalHeader]' });

		const heading = document.querySelector('.hub-modal__header > .hub-modal__heading');

		expect(heading, 'the header draws its heading').toBeTruthy();
		expect(classesOf(heading)).toEqual(['c-title', 'c-subtitle', 'c-badge']);
	});

	/** Only two children, so nothing the caller projects can end up after the button. */
	it('keeps the close button the last child of the header', () => {
		open(MultiNodeHeaderComponent, { headerSelector: '[hubModalHeader]' });

		const header = document.querySelector('.hub-modal__header');

		expect(classesOf(header)).toEqual(['hub-modal__heading', 'hub-modal__close']);
		expect(header?.lastElementChild?.classList.contains('hub-modal__close')).toBe(true);
	});

	/** No selectors means no header, and the content box holds the body and nothing else. */
	it('leaves a modal opened without header or footer selectors as it was', () => {
		open(SingleContentComponent);

		expect(document.querySelector('.hub-modal__header')).toBeNull();
		expect(document.querySelector('.hub-modal__heading')).toBeNull();
		expect(document.querySelector('.hub-modal__close')).toBeNull();
		expect(classesOf(document.querySelector('.hub-modal__content'))).toEqual(['hub-modal__body']);
		expect(document.querySelector('.hub-modal__body .c-body')).toBeTruthy();
	});
});
