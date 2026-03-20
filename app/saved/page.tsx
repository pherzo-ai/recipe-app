import Nav from '../components/Nav';
import SavedRecipes from '../components/SavedRecipes';

export default function Page() {
  return (
    <div className="saved-page">
      <Nav activePath="/saved" />
      <SavedRecipes />
    </div>
  );
}
