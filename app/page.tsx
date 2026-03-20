import Nav from './components/Nav';
import HomePage from './components/HomePage';

export default function Page() {
  return (
    <>
      <Nav activePath="/" />
      <HomePage />
    </>
  );
}
