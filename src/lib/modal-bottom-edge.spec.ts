import { ComponentFixture, TestBed } from '@angular/core/testing';

import { HubModalPlacement } from './modal-placement';
import { HubModalWindow } from './modal-window';

/**
 * A dialog that covers an edge has to reach it.
 *
 * Every floating dialog is capped at `100dvh` minus `--hub-modal-dialog-inset`, which carries
 * the margins it floats inside — 3.5rem by default. A dialog that has no margins has nothing to
 * discount, and leaving the cap at its default stops it 56px short of the bottom with a strip of
 * the page showing underneath: the footer of the dialog, and in a wizard the button that
 * continues it, sit over that strip.
 *
 * jsdom lays nothing out, so the cap is read from the cascade and from the shipped rules rather
 * than measured. That is where the defect lives in any case — which declaration wins — and a
 * pixel count here would only prove today's default.
 */
describe('hub-modal bottom edge', () => {
	let fixture: ComponentFixture<HubModalWindow>;

	beforeEach(() => {
		fixture = TestBed.createComponent(HubModalWindow);
	});

	const open = (placement: HubModalPlacement) => {
		fixture.componentRef.setInput('offcanvas', true);
		fixture.componentRef.setInput('placement', placement);
		fixture.detectChanges();

		const host: HTMLElement = fixture.nativeElement;
		return host.querySelector('.hub-modal__dialog') as HTMLElement;
	};

	/** The rules of one `@media (max-width: …)` block of the shipped sheet. */
	const rulesUnderBreakpoint = (): CSSStyleRule[] =>
		[...document.styleSheets]
			.flatMap((sheet) => [...(sheet.cssRules ?? [])])
			.filter((rule): rule is CSSMediaRule => rule instanceof CSSMediaRule)
			.flatMap((media) => [...media.cssRules] as CSSStyleRule[]);

	it('gives a side drawer the whole viewport, not the floating dialog’s share of it', () => {
		for (const placement of [HubModalPlacement.Start, HubModalPlacement.End]) {
			const dialog = open(placement);

			expect(getComputedStyle(dialog).maxHeight).toBe('100%');
			// The cap the content is drawn against. Any margin left in here is the strip of
			// page the drawer was supposed to cover.
			expect(getComputedStyle(dialog).getPropertyValue('--hub-modal-dialog-inset')).toBe('0px');

			fixture = TestBed.createComponent(HubModalWindow);
		}
	});

	it('gives a sheet from the top or the bottom its own measure, and no margin to discount', () => {
		for (const placement of [HubModalPlacement.Top, HubModalPlacement.Bottom]) {
			const dialog = open(placement);

			expect(getComputedStyle(dialog).maxHeight).toBe('var(--hub-modal-offcanvas-height)');
			expect(getComputedStyle(dialog).getPropertyValue('--hub-modal-dialog-inset')).toBe('0px');

			fixture = TestBed.createComponent(HubModalWindow);
		}
	});

	it('leaves nothing under a dialog that goes fullscreen below a breakpoint', () => {
		const breakpoints = ['sm', 'md', 'lg', 'xl', 'xxl'];

		for (const breakpoint of breakpoints) {
			const selector = `.hub-modal__dialog--fullscreen-${breakpoint}-down`;
			const rule = rulesUnderBreakpoint().find((candidate) => candidate.selectorText === selector);

			expect(rule).toBeDefined();
			// `margin: 0` is already there; the cap derived from those margins was not, so the
			// dialog covered the viewport while its content stopped 3.5rem above the floor.
			expect(rule!.style.getPropertyValue('--hub-modal-dialog-inset').trim()).toBe('0px');
		}
	});
});
