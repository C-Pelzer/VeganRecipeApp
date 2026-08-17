import { supabase } from '../supabaseClient'
import { uploadPhoto } from '../uploadPhoto'
import { getCurrentHouseholdId } from '../auth'
import type { RecipePhoto } from '../../types/recipe'

const BUCKET = 'recipe-images'

interface RecipePhotoRow {
  id: string
  recipe_id: string
  photo_url: string
  added_by: string
  added_at: string
}

function rowToPhoto(row: RecipePhotoRow): RecipePhoto {
  return {
    id: row.id,
    recipeId: row.recipe_id,
    photoUrl: row.photo_url,
    addedBy: row.added_by,
    addedAt: row.added_at,
  }
}

// Storage object path lives under the recipe id so cleanup/inspection can
// find all of a recipe's post-cook photos without going through the DB.
function storagePathFromUrl(photoUrl: string): string {
  const marker = `/object/public/${BUCKET}/`
  const index = photoUrl.indexOf(marker)
  return photoUrl.slice(index + marker.length)
}

async function listPhotos(recipeId: string): Promise<RecipePhoto[]> {
  const { data, error } = await supabase
    .from('recipe_photos')
    .select('*')
    .eq('recipe_id', recipeId)
    .order('added_at', { ascending: true })
  if (error) throw error
  return (data as RecipePhotoRow[]).map(rowToPhoto)
}

async function addPhoto(recipeId: string, file: File, addedBy: string): Promise<RecipePhoto> {
  const publicUrl = await uploadPhoto(recipeId, file, 'post-cook')

  const { data: row, error: insertError } = await supabase
    .from('recipe_photos')
    .insert({
      recipe_id: recipeId,
      photo_url: publicUrl,
      added_by: addedBy,
      household_id: getCurrentHouseholdId(),
    })
    .select('*')
    .single()
  if (insertError) throw insertError
  return rowToPhoto(row as RecipePhotoRow)
}

async function deletePhoto(photo: RecipePhoto): Promise<void> {
  const { error: storageError } = await supabase.storage
    .from(BUCKET)
    .remove([storagePathFromUrl(photo.photoUrl)])
  if (storageError) throw storageError

  const { error } = await supabase.from('recipe_photos').delete().eq('id', photo.id)
  if (error) throw error
}

export const recipePhotoStore = { listPhotos, addPhoto, deletePhoto }
