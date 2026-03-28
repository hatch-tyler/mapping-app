import { useToastStore } from './toastStore';

describe('toastStore', () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts with empty toasts', () => {
    expect(useToastStore.getState().toasts).toEqual([]);
  });

  it('addToast appends a toast with auto-generated id', () => {
    useToastStore.getState().addToast('Hello');
    const { toasts } = useToastStore.getState();
    expect(toasts).toHaveLength(1);
    expect(toasts[0].message).toBe('Hello');
    expect(toasts[0].id).toBeDefined();
  });

  it('addToast defaults type to info', () => {
    useToastStore.getState().addToast('Info message');
    expect(useToastStore.getState().toasts[0].type).toBe('info');
  });

  it('addToast respects specified type', () => {
    useToastStore.getState().addToast('Error!', 'error');
    expect(useToastStore.getState().toasts[0].type).toBe('error');

    useToastStore.getState().addToast('Success!', 'success');
    const toasts = useToastStore.getState().toasts;
    expect(toasts[1].type).toBe('success');
  });

  it('removeToast removes by id', () => {
    useToastStore.getState().addToast('First');
    useToastStore.getState().addToast('Second');
    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(2);

    useToastStore.getState().removeToast(toasts[0].id);
    expect(useToastStore.getState().toasts).toHaveLength(1);
    expect(useToastStore.getState().toasts[0].message).toBe('Second');
  });

  it('auto-dismisses after 5 seconds', () => {
    useToastStore.getState().addToast('Auto dismiss');
    expect(useToastStore.getState().toasts).toHaveLength(1);

    vi.advanceTimersByTime(4999);
    expect(useToastStore.getState().toasts).toHaveLength(1);

    vi.advanceTimersByTime(1);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });
});
