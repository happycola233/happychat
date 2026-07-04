export function imagePreviewMaxHeightClass(hasCaption: boolean) {
  return hasCaption
    ? 'max-h-[min(82dvh,calc(100dvh-13.25rem))] sm:max-h-[min(82dvh,calc(100dvh-14.75rem))]'
    : 'max-h-[min(82dvh,calc(100dvh-8.5rem))]'
}
