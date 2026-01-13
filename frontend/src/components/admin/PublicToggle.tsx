interface Props {
  isPublic: boolean;
  onChange: (isPublic: boolean) => void;
  disabled?: boolean;
}

export function PublicToggle({ isPublic, onChange, disabled }: Props) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={isPublic}
      disabled={disabled}
      onClick={() => onChange(!isPublic)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 ${
        isPublic ? 'bg-green-600' : 'bg-gray-200'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
          isPublic ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  );
}
