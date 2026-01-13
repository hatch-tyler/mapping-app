interface Props {
  visible: boolean;
  onChange: (visible: boolean) => void;
  disabled?: boolean;
}

export function VisibilityToggle({ visible, onChange, disabled }: Props) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={visible}
      disabled={disabled}
      onClick={() => onChange(!visible)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
        visible ? 'bg-blue-600' : 'bg-gray-200'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
          visible ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  );
}
