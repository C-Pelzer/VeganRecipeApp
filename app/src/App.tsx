import { useState } from 'react'
import { DeckScreen } from './features/deck/DeckScreen'
import { ProfilePicker } from './features/profile/ProfilePicker'
import { getCurrentUser, setCurrentUser, type HouseholdMember } from './lib/profile'

function App() {
  const [currentUser, setCurrentUserState] = useState<HouseholdMember | null>(getCurrentUser)

  function handleSelect(user: HouseholdMember) {
    setCurrentUser(user)
    setCurrentUserState(user)
  }

  return (
    <div className="h-full min-h-screen bg-neutral-950">
      {currentUser ? (
        <DeckScreen currentUser={currentUser} />
      ) : (
        <ProfilePicker onSelect={handleSelect} />
      )}
    </div>
  )
}

export default App
