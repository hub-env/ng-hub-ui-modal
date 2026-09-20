import { DOCUMENT, Location } from '@angular/common';
import {
	ApplicationRef,
	ComponentRef,
	createComponent,
	DestroyRef,
	EnvironmentInjector,
	EventEmitter,
	inject,
	Injectable,
	Injector,
	NgZone,
	TemplateRef,
	Type
} from '@angular/core';
import { ContentRef, hubFocusTrap, isDefined, isString, ScrollBar } from 'ng-hub-ui-utils';
import { Subject } from 'rxjs';
import { take } from 'rxjs/operators';
import { HubModalBackdrop } from './modal-backdrop';
import { HubModalOptions, HubModalUpdatableOptions } from './modal-config';
import { ModalDismissReasons } from './modal-dismiss-reasons';
import { HUB_MODAL_DATA, HubActiveModal, HubModalRef } from './modal-ref';
import { HubModalWindow } from './modal-window';

/**
 * The URL without its fragment, which is what decides whether the screen changed.
 *
 * An anchor moves the reader inside the screen the dialog belongs to; it does not replace it. A
 * sidebar that writes the anchor of the section on screen as the reader scrolls is ordinary, and
 * without this it would close every dialog a moment after it opened.
 */
function withoutFragment(url: string): string {
	const fragment = url.indexOf('#');
	return fragment === -1 ? url : url.slice(0, fragment);
}

/**
 * A service that manages the stack of currently active modal windows.
 * It is responsible for creating, attaching, and orchestrating the rendering
 * of the modal dialogue, its backdrop, and its content.
 */
@Injectable({ providedIn: 'root' })
export class HubModalStack {
	private _applicationRef = inject(ApplicationRef);
	private _injector = inject(Injector);
	private _environmentInjector = inject(EnvironmentInjector);
	private _document = inject(DOCUMENT);
	private _scrollBar = inject(ScrollBar);

	// Optional: the library has to work in an application with no router, where `Location`
	// has no strategy to read from and is not provided at all.
	private _location = inject(Location, { optional: true });
	private _destroyRef = inject(DestroyRef);

	private _activeWindowCmptHasChanged = new Subject<void>();
	private _ariaHiddenValues: Map<Element, string | null> = new Map();
	private _scrollBarRestoreFn: null | (() => void) = null;
	/** How far a dialog and its backdrop are lifted over the level below: one each. */
	private static readonly ZINDEX_STEP = 2;

	private _modalRefs: HubModalRef[] = [];
	private _closeOnNavigation = new WeakSet<HubModalRef>();
	private _watchingUrl = false;
	private _windowCmpts: ComponentRef<HubModalWindow>[] = [];
	private _activeInstances: EventEmitter<HubModalRef[]> = new EventEmitter();

	constructor() {
		const ngZone = inject(NgZone);

		// Trap focus on active WindowCmpt
		this._activeWindowCmptHasChanged.subscribe(() => {
			if (this._windowCmpts.length) {
				const activeWindowCmpt = this._windowCmpts[this._windowCmpts.length - 1];
				hubFocusTrap(ngZone, activeWindowCmpt.location.nativeElement, this._activeWindowCmptHasChanged);
				this._revertAriaHidden();
				this._setAriaHidden(activeWindowCmpt.location.nativeElement);
			}
		});
	}

	private _restoreScrollBar() {
		const scrollBarRestoreFn = this._scrollBarRestoreFn;
		if (scrollBarRestoreFn) {
			this._scrollBarRestoreFn = null;
			scrollBarRestoreFn();
		}
	}

	private _hideScrollBar() {
		if (!this._scrollBarRestoreFn) {
			this._scrollBarRestoreFn = this._scrollBar.hide();
		}
	}

	/**
	 * Opens a new modal window configured with the provided options.
	 *
	 * @param contentInjector The dependency injector to be used for the modal content component.
	 * @param content The content to display inside the modal. Can be a component class, a template reference, or a string.
	 * @param options Configuration options that dictate how the modal is rendered and behaves.
	 * @returns An instance of `HubModalRef` which can be used to control the modal or subscribe to its events.
	 * @throws Error if the specified container element is not found in the DOM.
	 */
	open(contentInjector: Injector, content: any, options: HubModalOptions): HubModalRef {
		const containerEl =
			options.container instanceof HTMLElement
				? options.container
				: isDefined(options.container)
					? this._document.querySelector(options.container!)
					: this._document.body;

		if (!containerEl) {
			throw new Error(`The specified modal container "${options.container || 'body'}" was not found in the DOM.`);
		}

		this._hideScrollBar();

		const activeModal = new HubActiveModal(options.data ?? null);

		contentInjector = options.injector || contentInjector;
		const environmentInjector = contentInjector.get(EnvironmentInjector, null) || this._environmentInjector;
		const contentRef = this._getContentRef(contentInjector, environmentInjector, content, activeModal, options);

		// Read before the new reference joins them: it is how many dialogs this one opens over.
		const level = this._modalRefs.length;

		const backdropCmptRef: ComponentRef<HubModalBackdrop> | undefined =
			options.backdrop !== false ? this._attachBackdrop(containerEl) : undefined;
		const windowCmptRef: ComponentRef<HubModalWindow> = this._attachWindowComponent(containerEl, contentRef.nodes, options);

		this._stack(level, windowCmptRef.location.nativeElement, backdropCmptRef?.location.nativeElement);
		const hubModalRef: HubModalRef = new HubModalRef(windowCmptRef, contentRef, backdropCmptRef, options.beforeDismiss);

		this._registerModalRef(hubModalRef);
		this._registerWindowCmpt(windowCmptRef);

		if (options.closeOnNavigation !== false) {
			this._closeOnNavigation.add(hubModalRef);
			this._watchUrlChanges();
		}

		// We have to cleanup DOM after the last modal when BOTH 'hidden' was emitted and 'result' promise was resolved:
		// - with animations OFF, 'hidden' emits synchronously, then 'result' is resolved asynchronously
		// - with animations ON, 'result' is resolved asynchronously, then 'hidden' emits asynchronously
		hubModalRef.hidden.pipe(take(1)).subscribe(() =>
			Promise.resolve(true).then(() => {
				if (!this._modalRefs.length) {
					this._document.body.classList.remove('hub-modal-open');
					this._restoreScrollBar();
					this._revertAriaHidden();
				}
			})
		);

		activeModal.close = (result: any) => {
			hubModalRef.close(result);
		};
		activeModal.dismiss = (reason: any) => {
			hubModalRef.dismiss(reason);
		};

		activeModal.update = (options: HubModalUpdatableOptions) => {
			hubModalRef.update(options);
		};

		hubModalRef.update(options);
		if (this._modalRefs.length === 1) {
			this._document.body.classList.add('hub-modal-open');
		}

		if (backdropCmptRef && backdropCmptRef.instance) {
			backdropCmptRef.changeDetectorRef.detectChanges();
		}
		windowCmptRef.changeDetectorRef.detectChanges();
		return hubModalRef;
	}

	/**
	 * Allows observing the array of active modal instances.
	 *
	 * @returns An event emitter that streams changes to the active modal references.
	 */
	get activeInstances() {
		return this._activeInstances;
	}

	/**
	 * Dismisses all currently open modal windows.
	 *
	 * @param reason Optional reason to pass to the dismissal routines of the active modals.
	 */
	dismissAll(reason?: any) {
		this._modalRefs.forEach((hubModalRef) => hubModalRef.dismiss(reason));
	}

	/**
	 * Checks whether there are any currently open modal windows.
	 *
	 * @returns `true` if at least one modal is active, `false` otherwise.
	 */
	hasOpenModals(): boolean {
		return this._modalRefs.length > 0;
	}

	/**
	 * Lifts a dialog and its backdrop above the ones already open.
	 *
	 * Every dialog used to be painted at the same height, and so was every backdrop, so the
	 * second backdrop landed *under* the first dialog: the new one floated over a page that
	 * was not dimmed, and what it covered still looked reachable. Two steps per level keeps
	 * each backdrop between the dialog below it and its own.
	 *
	 * The first dialog is left untouched on purpose. Writing the value inline would override
	 * a `--hub-modal-zindex` the application themed, and at level zero there is nothing to
	 * lift it above.
	 */
	private _stack(level: number, windowEl: HTMLElement, backdropEl?: HTMLElement) {
		if (level === 0) {
			return;
		}

		const lift = level * HubModalStack.ZINDEX_STEP;
		const base = 'var(--hub-modal-zindex-base, var(--hub-sys-zindex-modal, 1055))';

		windowEl.style.setProperty('--hub-modal-zindex', `calc(${base} + ${lift})`);
		// Set on the element rather than left to the `:root` rule that derives it: a custom
		// property is substituted where it is declared, so the derived value inherits already
		// computed and never sees the window's own.
		backdropEl?.style.setProperty('--hub-modal-backdrop-zindex', `calc(${base} + ${lift - 1})`);
	}

	private _attachBackdrop(containerEl: Element): ComponentRef<HubModalBackdrop> {
		let backdropCmptRef = createComponent(HubModalBackdrop, {
			environmentInjector: this._applicationRef.injector,
			elementInjector: this._injector
		});
		this._applicationRef.attachView(backdropCmptRef.hostView);
		containerEl.appendChild(backdropCmptRef.location.nativeElement);
		return backdropCmptRef;
	}

	private _attachWindowComponent(
		containerEl: Element,
		contentNodes: Node[][],
		options: HubModalOptions
	): ComponentRef<HubModalWindow> {
		const singleContent = !options.headerSelector && !options.footerSelector;
		let windowCmptRef = createComponent(HubModalWindow, {
			environmentInjector: this._applicationRef.injector,
			elementInjector: this._injector
		});

		Object.assign(windowCmptRef.instance, { singleContent });

		this._applicationRef.attachView(windowCmptRef.hostView);
		containerEl.appendChild(windowCmptRef.location.nativeElement);
		windowCmptRef.changeDetectorRef.detectChanges();
		windowCmptRef.instance.attachContent(contentNodes);
		return windowCmptRef;
	}

	private _getContentRef(
		contentInjector: Injector,
		environmentInjector: EnvironmentInjector,
		content: Type<any> | TemplateRef<any> | string,
		activeModal: HubActiveModal,
		options: HubModalOptions
	): ContentRef {
		if (!content) {
			return new ContentRef([]);
		} else if (content instanceof TemplateRef) {
			return this._createFromTemplateRef(content, activeModal, options);
		} else if (isString(content)) {
			return this._createFromString(content);
		} else {
			return this._createFromComponent(contentInjector, environmentInjector, content, activeModal, options);
		}
	}

	private _createFromTemplateRef(
		templateRef: TemplateRef<any>,
		activeModal: HubActiveModal,
		options: HubModalOptions
	): ContentRef {
		const context = {
			$implicit: activeModal,
			close(result: any) {
				activeModal.close(result);
			},
			dismiss(reason: any) {
				activeModal.dismiss(reason);
			}
		};
		const viewRef = templateRef.createEmbeddedView(context);
		this._applicationRef.attachView(viewRef);

		const containerNode = document.createElement('ng-container');
		containerNode.append(...viewRef.rootNodes);

		this._addDismissEventListener(containerNode, context as any, options);
		this._addCloseEventListener(containerNode, context as any, options);

		return new ContentRef(splitIntoSlots(containerNode, options), viewRef);
	}

	private _createFromString(content: string): ContentRef {
		const component = this._document.createTextNode(`${content}`);
		// Three slots, always: `attachContent` destructures `[header, body, footer]`, and
		// `splitIntoSlots` — the path every other kind of content takes — returns three.
		// Returning one put the text in the HEADER slot and left the body `undefined`, so
		// appending it threw before the window could arm its Escape handler: a string modal
		// opened blank and could not be closed with the keyboard.
		return new ContentRef([[], [component], []]);
	}

	private _createFromComponent(
		contentInjector: Injector,
		environmentInjector: EnvironmentInjector,
		componentType: Type<any>,
		context: HubActiveModal,
		options: HubModalOptions
	): ContentRef {
		const elementInjector = Injector.create({
			providers: [
				{ provide: HubActiveModal, useValue: context },
				{ provide: HUB_MODAL_DATA, useValue: options.data ?? null }
			],
			parent: contentInjector
		});
		const componentRef = createComponent(componentType, {
			environmentInjector,
			elementInjector
		});

		/**
		 * @deprecated Since 22.3.0. Kept for one release for backward compatibility.
		 * Prefer reading the payload through the typed `inject(HUB_MODAL_DATA)` token or
		 * `inject(HubActiveModal).data`. This untyped monkey-patch of a `data` field on the
		 * component instance will be removed in a future major.
		 */
		if (options.data) {
			Object.assign(componentRef.instance, {
				data: options.data
			});
		}

		const componentNativeEl: HTMLElement = componentRef.location.nativeElement;
		this._applicationRef.attachView(componentRef.hostView);

		this._addDismissEventListener(componentNativeEl, context, options);
		this._addCloseEventListener(componentNativeEl, context as any, options);

		// The component host is only a query root: `splitIntoSlots` hands its children to the
		// window and the host itself never enters the document, so anything set on it is lost.
		// `scrollable` is delivered by the dialog instead, in `HubModalWindow`.
		return new ContentRef(splitIntoSlots(componentNativeEl, options), componentRef.hostView, componentRef);
	}

	private _setAriaHidden(element: Element) {
		const parent = element.parentElement;
		if (parent && element !== this._document.body) {
			Array.from(parent.children).forEach((sibling) => {
				if (sibling !== element && sibling.nodeName !== 'SCRIPT') {
					this._ariaHiddenValues.set(sibling, sibling.getAttribute('aria-hidden'));
					sibling.setAttribute('aria-hidden', 'true');
				}
			});

			this._setAriaHidden(parent);
		}
	}

	private _revertAriaHidden() {
		this._ariaHiddenValues.forEach((value, element) => {
			if (value) {
				element.setAttribute('aria-hidden', value);
			} else {
				element.removeAttribute('aria-hidden');
			}
		});
		this._ariaHiddenValues.clear();
	}

	/**
	 * Starts listening for URL changes, so an open dialog does not outlive the screen that
	 * opened it.
	 *
	 * `Location.onUrlChange` rather than `Location.subscribe`: the latter only hears the browser's
	 * own back and forward, and the navigation that strands a dialog is usually a link the reader
	 * clicked, which the router resolves without any of that.
	 *
	 * One listener for the whole stack, registered once and dropped only when the application is
	 * torn down. One per dialog is what this looked like first, and it does not work: `Location`
	 * notifies with a `forEach` over the live array, and a dialog that unsubscribes while being
	 * dismissed shifts the indices under that walk, so the listener sitting after it is skipped —
	 * silently, and not necessarily one of ours.
	 */
	private _watchUrlChanges() {
		if (this._watchingUrl || !this._location) {
			return;
		}

		this._watchingUrl = true;
		let previous = withoutFragment(this._location.path(true));

		this._destroyRef.onDestroy(
			this._location.onUrlChange((url) => {
				const next = withoutFragment(url);
				if (next === previous) {
					return;
				}

				previous = next;
				this._dismissOnNavigation();
			})
		);
	}

	/**
	 * Dismisses every open dialog that did not opt out of closing on navigation.
	 *
	 * Walks a copy: a dismissal takes its own reference out of `_modalRefs` as it goes.
	 */
	private _dismissOnNavigation() {
		for (const hubModalRef of [...this._modalRefs]) {
			if (this._closeOnNavigation.has(hubModalRef)) {
				hubModalRef.dismiss(ModalDismissReasons.NAVIGATION);
			}
		}
	}

	private _registerModalRef(hubModalRef: HubModalRef) {
		const unregisterModalRef = () => {
			const index = this._modalRefs.indexOf(hubModalRef);
			if (index > -1) {
				this._modalRefs.splice(index, 1);
				this._activeInstances.emit(this._modalRefs);
			}
		};
		this._modalRefs.push(hubModalRef);
		this._activeInstances.emit(this._modalRefs);
		hubModalRef.result.then(unregisterModalRef, unregisterModalRef);
	}

	private _registerWindowCmpt(hubWindowCmpt: ComponentRef<HubModalWindow>) {
		this._windowCmpts.push(hubWindowCmpt);
		this._activeWindowCmptHasChanged.next();

		hubWindowCmpt.onDestroy(() => {
			const index = this._windowCmpts.indexOf(hubWindowCmpt);
			if (index > -1) {
				this._windowCmpts.splice(index, 1);
				this._activeWindowCmptHasChanged.next();
			}
		});
	}

	/**
	 * Attaches click event listeners to elements within a container based on a specified dismiss selector to dismiss a modal.
	 *
	 * @param {HTMLElement} container - The `container` parameter is an HTMLElement that represents the DOM element which contains the
	 * modal content.
	 * @param {HubActiveModal} context - The `context` parameter in the `_addDismissEventListener` function refers to the active modal
	 * instance that is being displayed. It is used to call the `dismiss` method on the modal instance when a dismissible element is
	 * clicked.
	 * @param {HubModalOptions} options - The `options` parameter is an object that contains configuration options for the modal. It
	 * may include properties such as `dismissSelector`, which is used to specify a CSS selector for elements that, when clicked, will
	 * dismiss the modal by calling the `dismiss` method on the `context` object.
	 */
	private _addDismissEventListener(container: HTMLElement, context: HubActiveModal, options: HubModalOptions) {
		if (options.dismissSelector) {
			const dismissaable: NodeListOf<Element> = container.querySelectorAll(options.dismissSelector);
			for (const item of Array.from(dismissaable)) {
				item.addEventListener('click', () => context.dismiss());
			}
		}
	}

	/**
	 * Attaches click event listeners to elements matching a specified selector to close a modal window.
	 *
	 * @param {HTMLElement} container - The `container` parameter is an HTMLElement that represents the DOM element which contains the
	 * modal content.
	 * @param {HubActiveModal} context - The `context` parameter in the `_addCloseEventListener` function is of type `HubActiveModal`.
	 * It is used to reference the active modal instance within the function and call the `close()` method on it when a close event is
	 * triggered.
	 * @param {HubModalOptions} options - The `options` parameter is an object that contains configuration options for the modal. It
	 * may include properties such as `closeSelector`, which is used to specify the selector for elements that can trigger the modal
	 * to close when clicked.
	 */
	private _addCloseEventListener(container: HTMLElement, context: HubActiveModal, options: HubModalOptions) {
		if (options.closeSelector) {
			const dismissaable: NodeListOf<Element> = container.querySelectorAll(options.closeSelector);
			for (const item of Array.from(dismissaable)) {
				item.addEventListener('click', () => context.close());
			}
		}
	}
}

/**
 * Split a container into the modal's three slots, taking nothing out of the document twice.
 *
 * Order is load-bearing and used not to be. The old code read the body as
 * `Array.from(container.childNodes)` **between** the header and the footer extractions, so
 * the footer's marker element was still a child when the body was captured: the body ended
 * up carrying an emptied marker `<div>` that the footer had already stripped.
 *
 * Every declared slot is taken out first; what nobody claimed is the body's, and it follows
 * whatever an explicit `bodySelector` matched. That is what makes the new option safe to add
 * to content that already works — naming the body can reorder it, never lose it.
 */
function splitIntoSlots(
	container: HTMLElement,
	options: { headerSelector?: string; bodySelector?: string; footerSelector?: string }
): Node[][] {
	const header = options.headerSelector ? extractAndRemoveNodesBySelector(container, options.headerSelector) : [];
	const footer = options.footerSelector ? extractAndRemoveNodesBySelector(container, options.footerSelector) : [];
	const declaredBody = options.bodySelector ? extractAndRemoveNodesBySelector(container, options.bodySelector) : [];

	// Whatever is left belongs to the body, so nothing a consumer wrote can go missing.
	const remainder = Array.from(container.childNodes);

	return [header, [...declaredBody, ...remainder], footer];
}

/**
 * Extracts the children of every element matching `selector` inside `container` and takes those
 * matched elements out of the DOM, so the caller can hand the children to another slot without
 * the marker element travelling with them.
 *
 * @param {HTMLElement} container - Element searched for the selector.
 * @param {string} selector - CSS selector identifying the slot markers.
 *
 * @returns The children of every matched element, in document order.
 */
function extractAndRemoveNodesBySelector(container: HTMLElement, selector: string): Array<Node> {
	const containerNodes = container.querySelectorAll(selector);

	const nodes = Array.from(containerNodes).reduce((acc, c) => {
		return [...acc, ...Array.from(c.childNodes)];
	}, [] as Array<Node>);

	Array.from(containerNodes).forEach((node) => node.remove());
	return nodes;
}
