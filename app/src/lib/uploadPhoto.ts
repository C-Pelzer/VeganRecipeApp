import { supabase } from './supabaseClient'

// Shared by recipePhotoStore (post-cook photos) and AddRecipeScreen (a
// manually-added recipe's primary photo) — both need "send this File to the
// fetch-page edge function, get back a hosted Storage URL." Resizing happens
// server-side there (see supabase/functions/fetch-page/index.ts) since a raw
// phone-camera photo reliably crashes client-side canvas/ImageBitmap resize
// on real Android hardware.
export async function uploadPhoto(recipeId: string, file: File, kind: 'hero' | 'post-cook'): Promise<string> {
  const form = new FormData()
  form.append('recipeId', recipeId)
  form.append('kind', kind)
  form.append('file', file)

  const { data, error } = await supabase.functions.invoke<{ publicUrl: string; error?: string }>('fetch-page', {
    body: form,
  })
  if (error) throw error
  if (!data || data.error) throw new Error(data?.error ?? 'Upload failed.')
  return data.publicUrl
}
