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
      title={
        isPublic
          ? 'Public — accessible to anyone with the URL (no login required). Click to make private.'
          : 'Private — only authenticated users with access can view. Click to make public.'
      }
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 ${
        isPublic ? 'bg-amber-500' : 'bg-gray-200'
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
