import { useState } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { NavDrawer } from './components/NavDrawer'
import { RecipeDetailModal } from './components/RecipeDetailModal'
import { DeckScreen } from './features/deck/DeckScreen'
import { DecksHomeScreen } from './features/decksHome/DecksHomeScreen'
import { FavoritesScreen } from './features/favorites/FavoritesScreen'
import { ShoppingListScreen } from './features/shoppingList/ShoppingListScreen'
import { MealPlanScreen } from './features/mealPlan/MealPlanScreen'
import { MealCalendarScreen } from './features/mealCalendar/MealCalendarScreen'
import { ImportRecipeScreen } from './features/importRecipe/ImportRecipeScreen'
import { CatalogScreen } from './features/catalog/CatalogScreen'
import { ProfilePicker } from './features/profile/ProfilePicker'
import { clearCurrentUser, getCurrentUser, setCurrentUser, type HouseholdMember } from './lib/profile'

function App() {
  const [currentUser, setCurrentUserState] = useState<HouseholdMember | null>(getCurrentUser)
  const [menuOpen, setMenuOpen] = useState(false)
  const [viewingRecipeId, setViewingRecipeId] = useState<string | null>(null)

  function handleSelect(user: HouseholdMember) {
    setCurrentUser(user)
    setCurrentUserState(user)
  }

  function handleSwitchUser() {
    clearCurrentUser()
    setCurrentUserState(null)
    setMenuOpen(false)
  }

  return (
    <div className="h-full bg-neutral-950">
      {currentUser ? (
        <BrowserRouter>
          <NavDrawer
            isOpen={menuOpen}
            onClose={() => setMenuOpen(false)}
            currentUser={currentUser}
            onSwitchUser={handleSwitchUser}
          />
          <RecipeDetailModal recipeId={viewingRecipeId} onClose={() => setViewingRecipeId(null)} />
          <Routes>
            <Route
              path="/"
              element={<DecksHomeScreen currentUser={currentUser} onOpenMenu={() => setMenuOpen(true)} />}
            />
            <Route
              path="/deck/:deckId"
              element={
                <DeckScreen
                  currentUser={currentUser}
                  onOpenMenu={() => setMenuOpen(true)}
                  onViewRecipe={setViewingRecipeId}
                />
              }
            />
            <Route
              path="/favorites"
              element={
                <FavoritesScreen
                  currentUser={currentUser}
                  onOpenMenu={() => setMenuOpen(true)}
                  onViewRecipe={setViewingRecipeId}
                />
              }
            />
            <Route
              path="/shopping-list"
              element={<ShoppingListScreen onOpenMenu={() => setMenuOpen(true)} />}
            />
            <Route
              path="/meal-plan"
              element={
                <MealPlanScreen onOpenMenu={() => setMenuOpen(true)} onViewRecipe={setViewingRecipeId} />
              }
            />
            <Route
              path="/meal-calendar"
              element={
                <MealCalendarScreen onOpenMenu={() => setMenuOpen(true)} onViewRecipe={setViewingRecipeId} />
              }
            />
            <Route
              path="/import"
              element={
                <ImportRecipeScreen
                  currentUser={currentUser}
                  onOpenMenu={() => setMenuOpen(true)}
                  onViewRecipe={setViewingRecipeId}
                />
              }
            />
            <Route
              path="/catalog"
              element={
                <CatalogScreen
                  currentUser={currentUser}
                  onOpenMenu={() => setMenuOpen(true)}
                  onViewRecipe={setViewingRecipeId}
                />
              }
            />
          </Routes>
        </BrowserRouter>
      ) : (
        <ProfilePicker onSelect={handleSelect} />
      )}
    </div>
  )
}

export default App
