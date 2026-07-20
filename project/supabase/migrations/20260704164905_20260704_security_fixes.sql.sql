-- Security Fixes
-- 1. Fix mutable search_path on functions
-- 2. Change from SECURITY DEFINER to SECURITY INVOKER
-- 3. Restrict EXECUTE to authenticated users only
-- 4. Fix storage bucket listing policy

-- Drop and recreate increment_times_worn function with security fixes
DROP FUNCTION IF EXISTS public.increment_times_worn(uuid);

CREATE OR REPLACE FUNCTION public.increment_times_worn(item_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.clothing_items
  SET 
    times_worn = times_worn + 1,
    last_worn_date = CURRENT_DATE
  WHERE id = item_id
    AND user_id = auth.uid();
END;
$$;

-- Restrict execution to authenticated users only
REVOKE ALL ON FUNCTION public.increment_times_worn(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.increment_times_worn(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.increment_times_worn(uuid) TO authenticated;

-- Drop and recreate delete_user function with security fixes
DROP FUNCTION IF EXISTS public.delete_user();

CREATE OR REPLACE FUNCTION public.delete_user()
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  uid uuid;
BEGIN
  uid := auth.uid();
  
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  
  -- Delete user's data
  DELETE FROM public.clothing_items WHERE user_id = uid;
  DELETE FROM public.outfits WHERE user_id = uid;
  DELETE FROM public.style_preferences WHERE user_id = uid;
  
  -- Delete user's storage objects
  DELETE FROM storage.objects 
  WHERE bucket_id = 'clothing-photos' 
    AND name LIKE uid::text || '/%';
END;
$$;

-- Restrict execution to authenticated users only
REVOKE ALL ON FUNCTION public.delete_user() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_user() FROM anon;
GRANT EXECUTE ON FUNCTION public.delete_user() TO authenticated;

-- 4. Fix storage bucket - remove broad listing policy
-- First, drop the existing policy
DROP POLICY IF EXISTS "Anyone can view clothing photos" ON storage.objects;

-- Create a more restrictive policy - only allow access to user's own folder
-- Public read access for individual file URLs (not listing)
CREATE POLICY "Public can view individual clothing photos"
ON storage.objects
FOR SELECT
TO public
USING (
  bucket_id = 'clothing-photos'
  AND (
    -- Allow access if the path starts with the user's ID (their own uploads)
    -- Extract user_id from path: "user_id/filename"
    auth.uid()::text = split_part(name, '/', 1)
    OR
    -- For public serving, also allow if file has a public marker (optional)
    -- We use signed URLs instead, so only owner can access
    auth.uid()::text = split_part(name, '/', 1)
  )
);

-- Ensure users can only upload to their own folder
CREATE POLICY "Users can upload to own folder"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'clothing-photos'
  AND auth.uid()::text = split_part(name, '/', 1)
);

-- Ensure users can only update their own files
CREATE POLICY "Users can update own files"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'clothing-photos'
  AND auth.uid()::text = split_part(name, '/', 1)
);

-- Ensure users can only delete their own files
CREATE POLICY "Users can delete own files"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'clothing-photos'
  AND auth.uid()::text = split_part(name, '/', 1)
);
