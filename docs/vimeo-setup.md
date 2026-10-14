# Vimeo setup for the Resource Library

Course lessons play Vimeo videos inside the app. The app doesn't host or upload video; it shows Vimeo's player. For that to work, each video has to allow embedding on the app's domains. That's a setting in your Vimeo account, and the app can't change it for you.

## What to set on every course video

In Vimeo, open the video, then **Settings → Privacy** (on some plans: **Share → Embed → Where can this be embedded?**).

1. **Who can watch:** pick **Unlisted** ("Anyone with the private link") or **Hide from Vimeo**. Don't pick "Only me" or "Password"; the app can't play those.
2. **Where can this be embedded:** pick **Specific domains** and add:
   - `dadedgeoperatingsystem.com` (production)
   - `localhost` (only while testing on your own computer; remove it later if you like)
   - any preview domain you test on, for example `your-project.vercel.app`
3. Save.

Do this for every video you put in a course. If you upload a batch, Vimeo lets you set embed domains once for the whole account under **Settings → Video → Upload defaults**, so new uploads get them automatically.

## Pasting links into a lesson

Copy the link from Vimeo's **Share** button and paste it into the lesson's Vimeo link box.

- Unlisted links look like `https://vimeo.com/123456789/abc123def4`. Keep the part after the second slash. It's the privacy code, and an unlisted video won't play without it. The app saves it for you.
- The app checks the link with Vimeo when you click **Check link** or leave the box, and again every time you save. If Vimeo won't describe the video, you'll see: "We couldn't read that Vimeo link. Check that the video exists and that embedding is allowed." Nothing saves until the link works.

## What a member sees when a video isn't allowed

The lesson page loads, shows the video's thumbnail, and when he presses play, Vimeo's own error appears inside the player (usually "Because of its privacy settings, this video cannot be played here"). The rest of the lesson (description, PDFs, Mark as complete) still works. Fix it by adding the domain in step 2 above; no change in the app is needed.

## Checking a video quickly

Use **Preview as member** on the lesson editor. If the thumbnail shows and the video plays after you press play, members will see the same thing.
