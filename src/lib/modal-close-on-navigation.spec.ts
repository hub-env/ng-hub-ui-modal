import { Location } from '@angular/common';
import { TestBed } from '@angular/core/testing';

import { HubModal } from './modal';
import { ModalDismissReasons } from './modal-dismiss-reasons';

/**
 * A dialog belongs to the screen that opened it.
 *
 * Left alone it outlives that screen: the new one renders behind a backdrop that swallows every
 * click, and nothing on it says why. Escape still worked, which made it look like the dialog was
 * gone when it was only unfocused — the interface just stopped answering.
 *
 * The listener is `Location.onUrlChange`, not `Location.subscribe`, because the navigation that
 * strands a dialog is usually a link the reader clicked and the router resolved, which
 * `subscribe` never reports.
 */
describe('closing on navigation', () => {
	let location: Location;

	beforeEach(() => {
		location = TestBed.inject(Location);
	});

	afterEach(() => {
		document.querySelectorAll('hub-modal-window, hub-modal-backdrop').forEach((el) => el.remove());
	});

	const open = (closeOnNavigation?: boolean) =>
		TestBed.inject(HubModal).open('Content', { animation: false, closeOnNavigation });

	it('dismisses the dialog when the URL changes, saying why', async () => {
		const reason = open()
			.result.then(() => 'closed')
			.catch((dismissal) => dismissal);

		location.go('/somewhere-else');

		await expect(reason).resolves.toBe(ModalDismissReasons.NAVIGATION);
	});

	it('leaves the dialog alone when the consumer opts out', async () => {
		const settled = vi.fn();
		open(false).result.then(settled, settled);

		location.go('/somewhere-else');
		await Promise.resolve();

		expect(settled).not.toHaveBeenCalled();
	});

	/**
	 * `Location` notifies with a `forEach` over the live listener array, so a dialog that
	 * unsubscribed from inside its own callback shifted the indices under the walk and whatever
	 * came next was skipped. Two dialogs, and only the first one closed.
	 */
	it('closes every dialog in the stack, not only the first', async () => {
		const first = open()
			.result.then(() => 'closed')
			.catch((dismissal) => dismissal);
		const second = open()
			.result.then(() => 'closed')
			.catch((dismissal) => dismissal);

		location.go('/somewhere-else');

		await expect(first).resolves.toBe(ModalDismissReasons.NAVIGATION);
		await expect(second).resolves.toBe(ModalDismissReasons.NAVIGATION);
	});

	/**
	 * The same skipping reached listeners that are none of the library's business: anything the
	 * application registered after the dialog went unnotified for that navigation.
	 */
	it("leaves the application's own URL listeners intact", () => {
		open().result.catch(() => {});

		const heard = vi.fn();
		location.onUrlChange(heard);

		location.go('/somewhere-else');

		expect(heard).toHaveBeenCalledTimes(1);
	});
});
