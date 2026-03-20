import { Suspense } from 'react';
import Nav from '../components/Nav';
import RecipeViewer from '../components/RecipeViewer';

export default function Page() {
  return (
    <>
      <Nav activePath="/recipe" />
      <Suspense fallback={<div style={{ padding: '4rem', textAlign: 'center' }}>Loading…</div>}>
        <RecipeViewer />
      </Suspense>
    </>
  );
}
