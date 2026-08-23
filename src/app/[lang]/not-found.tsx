import NotFoundContent from '@/components/NotFoundContent';

/**
 * The boundary for a `notFound()` raised inside a page, which is already under
 * the layout and its provider. The commoner case — a first path segment that is
 * not a locale — is thrown by the layout itself and lands on the root
 * `app/not-found.tsx` instead. The page they render is the same one.
 */
export default function NotFound() {
  return <NotFoundContent />;
}
