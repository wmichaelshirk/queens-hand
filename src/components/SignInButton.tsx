'use client'

import { createClient } from '@/utils/supabase/client'
import { useEffect, useState } from 'react'

export default function SignInButton() {
  const [loading, setLoading] = useState(false)
  const [user, setUser] = useState<any>(null)
  const [email, setEmail] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [messageSent, setMessageSent] = useState(false)
  const supabase = createClient()

  useEffect(() => {
    const checkUser = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      setUser(user)
    }

    checkUser()

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setUser(session?.user ?? null)
        setShowForm(false)
        setMessageSent(false)
      }
    )

    return () => {
      subscription.unsubscribe()
    }
  }, [supabase.auth])

  const handleSignInWithMagicLink = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!email) return

    try {
      setLoading(true)
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${location.origin}/auth/callback`,
        },
      })

      if (error) {
        console.error('Error sending magic link:', error)
      } else {
        setMessageSent(true)
      }
    } catch (error) {
      console.error('Error sending magic link:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleSignOut = async () => {
    try {
      setLoading(true)
      await supabase.auth.signOut()
    } catch (error) {
      console.error('Error signing out:', error)
    } finally {
      setLoading(false)
    }
  }

  if (user) {
    return (
      <button
        className="rounded-full border border-solid border-black/[.08] dark:border-white/[.145] transition-colors flex items-center justify-center hover:bg-[#f2f2f2] dark:hover:bg-[#1a1a1a] hover:border-transparent font-medium text-sm sm:text-base h-10 sm:h-12 px-4 sm:px-5 w-full sm:w-auto"
        onClick={handleSignOut}
        disabled={loading}
      >
        Sign Out
      </button>
    )
  }

  if (showForm) {
    if (messageSent) {
      return (
        <div className="flex flex-col items-center gap-2 p-4 bg-green-50 dark:bg-green-900/20 rounded-lg max-w-xs">
          <p className="text-sm text-center">Check your email for a magic link to sign in!</p>
          <button
            className="text-xs underline"
            onClick={() => setShowForm(false)}
          >
            Back
          </button>
        </div>
      )
    }

    return (
      <form onSubmit={handleSignInWithMagicLink} className="flex flex-col gap-2 p-4 bg-gray-50 dark:bg-gray-800/20 rounded-lg max-w-xs">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Enter your email"
          required
          className="px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-md text-sm bg-white dark:bg-black"
        />
        <div className="flex gap-2 mt-1">
          <button
            type="submit"
            disabled={loading}
            className="flex-1 rounded-md bg-foreground text-background py-2 text-sm font-medium transition-colors hover:bg-[#383838] dark:hover:bg-[#ccc]"
          >
            {loading ? 'Sending...' : 'Send Magic Link'}
          </button>
          <button
            type="button"
            onClick={() => setShowForm(false)}
            className="px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-md text-sm"
          >
            Cancel
          </button>
        </div>
      </form>
    )
  }

  return (
    <button
      className="rounded-full border border-solid border-transparent transition-colors flex items-center justify-center bg-foreground text-background gap-2 hover:bg-[#383838] dark:hover:bg-[#ccc] font-medium text-sm sm:text-base h-10 sm:h-12 px-4 sm:px-5 sm:w-auto"
      onClick={() => setShowForm(true)}
      disabled={loading}
    >
      Sign In
    </button>
  )
}
