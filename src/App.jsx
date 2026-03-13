import React from 'react'
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import Home from './pages/Home.jsx'
import WatchParty from './pages/WatchParty.jsx'

const App = () => {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/party/:roomCode" element={<WatchParty />} />
      </Routes>
    </Router>
  )
}

export default App
