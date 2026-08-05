import { useState } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { DeckScreen } from './features/deck/DeckScreen'
import { FavoritesScreen } from './features/favorites/FavoritesScreen'
import { RecipeDetailScreen } from './features/recipe/RecipeDetailScreen'
import { ProfilePicker } from './features/profile/ProfilePicker'
import { clearCurrentUser, getCurrentUser, setCurrentUser, type HouseholdMember } from './lib/profile'

function App() {
  const [currentUser, setCurrentUserState] = useState<HouseholdMember | null>(getCurrentUser)

  function handleSelect(user: HouseholdMember) {
    setCurrentUser(user)
    setCurrentUserState(user)
  }

  function handleSwitchUser() {
    clearCurrentUser()
    setCurrentUserState(null)
  }

  return (
    <div className="h-full min-h-screen bg-neutral-950">
      {currentUser ? (
        <BrowserRouter>
          <Routes>
            <Route
              path="/"
              element={<DeckScreen currentUser={currentUser} onSwitchUser={handleSwitchUser} />}
            />
            <Route
              path="/favorites"
              element={
                <FavoritesScreen currentUser={currentUser} onSwitchUser={handleSwitchUser} />
              }
            />
            <Route path="/recipe/:id" element={<RecipeDetailScreen />} />
          </Routes>
        </BrowserRouter>
      ) : (
        <ProfilePicker onSelect={handleSelect} />
      )}
    </div>
  )
}

export default App
