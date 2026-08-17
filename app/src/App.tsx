import { useState } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { BottomTabBar } from './components/BottomTabBar'
import { NavDrawer } from './components/NavDrawer'
import { RecipeDetailModal } from './components/RecipeDetailModal'
import { DeckScreen } from './features/deck/DeckScreen'
import { DecksHomeScreen } from './features/decksHome/DecksHomeScreen'
import { FavoritesScreen } from './features/favorites/FavoritesScreen'
import { ShoppingListScreen } from './features/shoppingList/ShoppingListScreen'
import { MealPlanScreen } from './features/mealPlan/MealPlanScreen'
import { MealCalendarScreen } from './features/mealCalendar/MealCalendarScreen'
import { ImportRecipeScreen } from './features/importRecipe/ImportRecipeScreen'
import { AddRecipeScreen } from './features/addRecipe/AddRecipeScreen'
import { CatalogScreen } from './features/catalog/CatalogScreen'
import { ProfilePicker } from './features/profile/ProfilePicker'
import { clearCurrentUser, getCurrentUser, setCurrentUser, type HouseholdMember } from './lib/profile'

// A backgrounded mobile tab (e.g. while the native camera app is in the
// foreground for a photo upload) can get its process killed for memory and
// come back as a fresh reload — this survives that by restoring which
// recipe was open instead of dropping back to the home screen.
const VIEWING_RECIPE_KEY = 'recipe-app:viewingRecipeId'

function App() {
  const [currentUser, setCurrentUserState] = useState<HouseholdMember | null>(getCurrentUser)
  const [menuOpen, setMenuOpen] = useState(false)
  const [viewingRecipeId, setViewingRecipeIdState] = useState<string | null>(() =>
    sessionStorage.getItem(VIEWING_RECIPE_KEY),
  )

  function setViewingRecipeId(recipeId: string | null) {
    setViewingRecipeIdState(recipeId)
    if (recipeId) sessionStorage.setItem(VIEWING_RECIPE_KEY, recipeId)
    else sessionStorage.removeItem(VIEWING_RECIPE_KEY)
  }

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
            onSwitchTo={handleSelect}
          />
          <RecipeDetailModal
            recipeId={viewingRecipeId}
            currentUser={currentUser}
            onClose={() => setViewingRecipeId(null)}
          />
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
              path="/add-recipe"
              element={
                <AddRecipeScreen
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
            {/* An unknown URL used to render a blank black page. */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          <BottomTabBar currentUser={currentUser} />
        </BrowserRouter>
      ) : (
        <ProfilePicker onSelect={handleSelect} />
      )}
    </div>
  )
}

export default App
