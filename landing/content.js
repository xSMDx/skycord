/* Roadmap and changelog content, lifted verbatim from the app-shell
   landing page so there is one source of truth for both. */
(function (w) {
  'use strict';
  var ROADMAP = [
  {
    stage: 'now', label: 'Building now', title: 'Channels & servers',
    items: [
      'Servers with text and voice channels, categories, and invite links — live now',
      'Roles and permissions, and channels only some people can open — live now',
      'Server settings, with a page for the server, its roles, and each channel — live now',
      'Server Mute, Server Deafen and Disconnect for someone in a voice channel — live now',
      'Dragging channels and categories into whatever order you want — live now',
      'Moving somebody into a different voice channel, rather than only disconnecting them',
      'Bans. Kicking works today; a ban that stops someone coming back does not exist yet',
      'Per-server notification settings, hiding muted channels, and a per-server profile'
    ]
  },
  {
    // Un-frozen 2026-08-25. It was on hold while channels was desktop-only;
    // channels shipped, so the phone caught up. Built in slices, and only the
    // finished slice is described as done.
    stage: 'now', label: 'Building now', title: 'Phone layout',
    items: [
      'Servers and channels on a phone — the server rail sits beside the channel list — live now',
      'Everything you tap is thumb-sized, and the buttons that used to need a hover are just there — live now',
      'Voice on a phone: the call screen, its controls, and who is in the room',
      'Making channels and sending invites from your phone'
    ]
  },
  {
    stage: 'shipped', label: 'Live now', title: 'One-command install',
    items: [
      'One command on a fresh Linux server: the app, the database, and the voice server together — live now',
      'Sensible defaults, so the secure setup is the one you get without reading anything — live now',
      'Updates that are one command too, and a broken update puts the last version back by itself — live now'
    ]
  },
  {
    stage: 'now', label: 'Building now', title: 'Desktop app',
    items: [
      'A real desktop app instead of a browser tab — for Windows, in testing now',
      'Add other people’s servers and switch between them, like TeamSpeak — your friend hosts his, you host yours, one app for both — live now',
      'Your own screen-share picker, with the stream quality you choose — live now',
      'Push-to-talk that works while the app is in the background',
      'Per-app audio capture, so sharing a game does not echo the call back'
    ]
  },
  {
    stage: 'next', label: 'Next up', title: 'Phone app',
    items: [
      'A real app rather than a website saved to your home screen',
      'Notifications that arrive when the app is closed',
      'The same list of servers as the desktop app'
    ]
  },
  {
    // After the apps deliberately, not by preference: with messages deleted
    // from the server once delivered, the device holds the only copy, and a
    // browser tab that "clear site data" can wipe is the wrong place for it.
    stage: 'next', label: 'Next up', title: 'End-to-end encryption',
    items: [
      'Tick a box when you make a chat and nobody but the people in it can read it — not us, not whoever runs the server',
      'New devices approved from a device you are already signed in on',
      'A backup code, so losing your laptop does not lose your history',
      'Needs the desktop and phone apps first: once messages are deleted from the server, your device holds the only copy',
      'Encrypted calls as well as messages'
    ]
  },
  {
    stage: 'idea', label: 'Being looked at', title: 'Quality of life',
    items: [
      'Filtering out other people talking near you — a different, harder problem than noise, and not solved yet',
      'Screen-share sound from one app instead of the whole PC, so sharing audio no longer sends the call back as an echo',
      'Link previews in chat',
      'Jump straight to any message from a link'
    ]
  },
  {
    stage: 'idea', label: 'Being looked at', title: 'Fun stuff',
    items: [
      'Custom emoji uploads',
      'Soundboard for calls',
      'Activity status like "Listening to Spotify"',
      'Themes that follow you between devices, and browsing ones other people made'
    ]
  },
  {
    // Last, because it is history rather than plan — and kept rather than
    // deleted: a roadmap that quietly removes what it delivered reads as one
    // that never promised it.
    //
    // Shipped in v0.14.0/v0.14.1, and shipped DIFFERENTLY from what this card
    // used to say. The old wording survived four releases past delivery, still
    // sitting under "Next up" and still promising an auto-pick that was
    // deliberately dropped.
    stage: 'shipped', label: 'Live now', title: 'Choose your voice server',
    items: [
      'Run more than one voice server, so people far from the box do not sound like it',
      'A voice channel can be pinned to one of them, and everyone in that channel lands on the same one — otherwise nobody hears anybody',
      'For direct calls you pick your own default, and anyone in the call can move it somewhere else mid-conversation',
      'Every server carries its own credentials, encrypted where they are stored, so one leak cannot reach the others',
      'It does not silently pick the fastest one for you. That was the original plan and it was dropped: guessing wrong splits a call in half, and the app now names the server you actually landed on instead'
    ]
  }
];

  var RELEASES = [{
    v: 'v0.20.3', date: 'Oct 2, 2026', time: '01:14 UTC+2', title: 'A blip is not a hang-up',
    items: [
      ['fix', 'People vanishing from a voice channel while still being in the call. Who is sitting in a channel and who you can see on the call screen came from two different places — the server’s own list, and the call itself — and only one of them noticed a brief network drop. Lose your connection for a second and the server took you out of the channel for everybody, while the call carried on and you stayed audible: a list of five people next to a call with eight in it. Your connection coming back now puts you back where you were, with your mute and deafen intact'],
      ['fix', 'A “Call ended” notice appearing in a DM or group while the call was still going on. Losing your connection for a second was read as hanging up, and the end of the call was written into the conversation for good — where nothing takes it back. Restarting the server did it to every call at once, each of which then carried straight on under a message saying it had finished. The server now waits to see whether anyone comes back before deciding a call is over. Leaving a call yourself, or being disconnected from one by a moderator, still ends it straight away'],
      ['fix', 'A tooltip staying on screen after you clicked the button it was describing, sitting on top of the menu the click had just opened. It happened on nearly every button in the app — a click both dismissed the tooltip and immediately brought it back. Tooltips now stay out of the way after a click, and still appear when you reach a button by keyboard'],
      ['fix', 'Friends › Online showing an empty page instead of saying anything, when you had friends but none of them were online. It now tells you that, rather than leaving you looking at a blank panel wondering whether something failed to load'],
      ['imp', 'Form fields across Settings now say what they are to a screen reader, and clicking a field’s label puts the cursor in it. The password fields also announce that they are required instead of relying on a red asterisk, which said nothing to anyone not seeing the colour']
    ]
  },
  {
    v: 'v0.20.2', date: 'Oct 1, 2026', time: '13:45 UTC+2', title: 'The app can tell you what it is',
    items: [
      ['fix', 'The Windows app stopped updating itself. It gave the download eight seconds at launch and then walked away from it, so the installer landed in a cache folder and was never applied — every launch, with nothing on screen to say so. One person ran a version eight days old while two releases shipped past them, and tested a feature three times on a build that did not contain it. The app no longer waits for anything at startup: an update downloads in the background while you use it, and installs when you press Restart'],
      ['add', 'Settings › Updates: what version you are on, what the updater is doing, a progress bar while it downloads, and a Restart button when it is ready. It also says when it last checked, and says so when there is nothing to do — an updater that has quietly given up should not look the same as one with no news'],
      ['add', 'A notice when an update is ready, which waits for an answer instead of fading away, and never appears while you are in a call'],
      ['add', 'A debug page, for when something is wrong and nobody can see why. Tap the server icon in Settings › About this instance seven times. It shows the app version, whether the screen-share components loaded, and what the updater last did, and copies the lot to your clipboard in one press — nothing on it is private'],
      ['imp', 'The launch screen no longer reports an update check it is not waiting for. It appears and gets out of the way'],
    ]
  },
  {
    v: 'v0.20.1', date: 'Sep 28, 2026', time: '13:47 UTC+2', title: 'The noise filter stops eating your voice',
    items: [
      ['fix', 'DeepFilterNet was cutting far too hard, and on some voices you could barely hear yourself. It shipped turning down whatever it judged not to be speech by 24dB, a figure checked against a synthesised voice — loud, clean and perfectly articulated, which is the easiest thing a speech model ever hears. A real voice on a real microphone is the hard case: measured against a quieter voice in more noise, the same setting cost 9.8dB at the peaks and the full 24dB through the body of the voice, because the model is unsure far more often on real input. The model being unsure is not something we can fix. How much it costs when it is, is: it now turns down by 12dB, so a wrong guess costs a quarter of what it did and a quiet voice comes back four times louder. Less noise is removed in exchange — a quarter of it left instead of a sixteenth, still twice what RNNoise manages on steady sound'],
      ['imp', 'DeepFilterNet is marked Beta, in Settings and here, and says what to listen for: if your voice sounds thin or drops out, switch back to RNNoise and tell us. It is measured, not finished, and the measuring used a synthesised voice — which is exactly how the fault above got shipped in the first place'],
      ['imp', 'A new skycord.xyz. The site shows the app doing each thing it describes rather than listing it, the Roadmap and the Changelog are their own pages now instead of sections, and a wrong address gets a real page and a real 404 instead of the front page pretending to be found'],
      ['fix', 'The filter’s one-off download is about 12MB, not the 10MB both the app and this page promised. The package documents 10.2MB compressed a way the server does not compress it'],
    ]
  },
  {
    v: 'v0.20.0', date: 'Sep 27, 2026', time: '20:45 UTC+2', title: 'Skycord for Windows, and a new coat of paint',
    items: [
      ['add', 'Skycord for Windows, as a release candidate. It is in <a href="#download" data-ch="download">#download</a>: one installer, and it keeps itself up to date from then on'],
      ['add', 'The app keeps a list of servers, yours and your friends’, and switches between them from Settings › Servers. The list lives in the app, so no server can see which others you use'],
      ['add', 'Its own screen-share picker: a window or a whole screen, the stream quality (Gaming, Screenshare, or your own resolution and frame rate), and the sound of your whole PC when you share the whole screen. That sound includes the call itself, and the picker says so'],
      ['fix', 'A screen share that stops going blurry. Three things were doing it, all on the sending side: everything from 30 fps up was published as “motion”, which tells the encoder to keep the frame rate and shrink the picture under any strain; the share went out in two sizes at once, and because a share tile is small in a call, every viewer was handed the small one; and under real strain the encoder was still free to choose. Now only 60 fps counts as motion, one size goes out, and the resolution is held. A share that stutters can be read — a share that goes soft cannot'],
      ['add', 'A title bar that belongs to Skycord: where you are — Friends, Direct Messages, or # channel and server — and back and forward through where you have been, with Alt+Left and Alt+Right too'],
      ['add', 'Settings › Performance, for a machine that is feeling its age. Max is everything as it was. Light turns the graphics card off, holds a call to two camera tiles at 360p, waits for a tap before animated pictures move, and uses the plain Windows title bar — measured at 41% less memory on the machine it was built on. Most of that one saving is the graphics card, and the drawing moves to the processor instead, so video can look worse and the fan can work harder. Advanced sets each switch by hand, and the page says which ones wait for a restart'],
      ['add', 'A third noise filter, in beta: DeepFilterNet 3, the strongest of them, and the one that copes with keyboards, clatter and echoey rooms rather than only steady sound like fans. Measured, it removes 24dB of noise and costs 1.9dB of your voice — but measured against a synthesised voice, not a room full of real ones, which is why it is marked beta. If yours sounds thin or drops out, switch back to RNNoise and tell us. It downloads about 12MB the first time you turn it on, asks more of your processor than RNNoise, and adds about 40ms to your voice'],
      ['fix', 'An invite you copy carries the address of the server you are on, so it works for the person you send it to'],
      ['fix', 'The app asks your server for its page every time it opens, instead of trusting a copy it kept. An update reaches you now rather than the next time the cache happens to give up'],
      ['imp', 'Signing in lasts. A login now runs for 90 days since you last used it, on the web and in the app, instead of ending seven days after you signed in however often you came back. A server set up by hand from an older .env.example still says 7d there: change it to 90d, or delete the line'],
      ['add', 'Light, Dark and Automatic at the top of Appearance. Automatic follows your system and remembers which light and which dark you like; the studio themes sit below them'],
      ['imp', 'Skycord’s colour is Sky now: buttons, links, mentions and the things you select. The light themes use a deeper Sky that stays readable. If you had picked Blurple yourself, you keep it, and an Automatic swatch brings the default back'],
      ['imp', 'Text on a coloured button is measured, not assumed: it picks dark or light by contrast, so every accent stays readable. Yellow buttons were close to unreadable before'],
      ['imp', 'Skycord’s own typefaces, Archivo and Chakra Petch, now load from your server instead of from Google'],
      ['add', 'Status is a shape as well as a colour: a dot for online, a crescent for idle, a bar for Do Not Disturb and a ring for offline, so nobody has to tell green from red'],
      ['fix', 'When your microphone cannot go live, Skycord says why: no access, none plugged in, in use by another app, or a channel you can only listen in. A refused unmute no longer shows an open microphone'],
      ['add', 'Settings › About this instance says who runs the server you are on and how to reach them. Settings › Legal holds its documents, next to Skycord’s licence, its source, and the licences of everything the app bundles'],
      ['add', 'Signing up names the server you are joining and links its documents, and every document can be read before you sign in. Hosts set all of it in the installer or in .env'],
      ['imp', 'Calls stay dark in the light themes, so video is not framed in white, and a muted microphone no longer wears the same red as going live'],
      ['fix', 'Searching the member list filters it, menus are grouped under names, and Home in the server rail works from the keyboard'],
      ['fix', 'Safari before 16.4 showed a blank page; it loads again. Avatars, server icons and flags that fail to load fall back instead of showing as broken, and a server named with an emoji or a “<” no longer breaks its icon'],
      ['imp', 'A lighter first load: the animation library arrives only when something animates, and nothing animates a layout property any more'],
      ['imp', 'skycord.xyz is a Skycord server now. You are reading this in one']
    ]
  },
  {
    v: 'v0.19.1', date: 'Sep 12, 2026', time: '10:26 UTC+2', title: 'One command to host your own',
    items: [
      ['add', 'One command installs a server: <code>curl -fsSL https://skycord.xyz/install.sh | sudo bash</code> on a fresh Linux machine. It asks for the address people will use and an email for certificate notices, and works out or generates everything else'],
      ['add', 'It sets up the whole thing: Skycord itself, MongoDB 4.4 with a password and reachable only by Skycord, LiveKit for voice and video on a single UDP port, and Caddy, which gets and renews the HTTPS certificate on its own'],
      ['add', 'Updates are one command too. <code>sudo skycord update</code> takes a backup first, and if the new version does not come up healthy it puts the previous one back by itself. <code>sudo skycord auto-update on</code> does it every night'],
      ['add', 'Everyday commands for hosts: <code>status</code> shows the version, health, disk, the last backup and whether an update is waiting; <code>logs</code> follows what it is doing; <code>config</code> changes settings; <code>backup</code> and <code>restore</code> do what they say'],
      ['add', 'It fits around what you already run: a web server of your own (Skycord then listens on 127.0.0.1 and prints the block to paste into it), an existing MongoDB or LiveKit, or no voice at all'],
      ['imp', 'Every release is rehearsed before it goes out: a fresh machine installs it, updates to it and rolls a broken update back, and only then is it published'],
      ['imp', 'The self-hosting guides were rewritten around the installer, and the manual steps are still there for anyone who wants them']
    ]
  },
  {
    v: 'v0.19.0', date: 'Sep 11, 2026', time: '21:40 UTC+2', title: 'Search, and scrolling all the way back',
    items: [
      ['add', 'Search. The box at the top right of a server searches all of it; in a direct message or a group it searches that conversation. Type words, put a phrase in quotes to keep it together, or put a minus in front of a word to leave it out. Words match whole and ignore case and accents, so 10 finds #10 but not #110, and cafe finds Café'],
      ['add', 'Filters, the ones you would expect: from: a person, in: a channel, has: a link, an image, a video or an embed, and mentions: a person. Type the word and its colon and the box suggests who or what you mean. More filters adds dates — before, after or on a day, by your own clock — and whether a message is pinned. Files, sounds, polls, stickers and forwards are listed and marked Soon, and so is author type, because none of those exist in Skycord yet'],
      ['add', 'Results open beside the chat, newest first or most relevant first, with the words you searched for marked. Pick one and the chat goes to it — into another channel if that is where it was posted, and as far back as it was written, not only as far as happened to be loaded. Your last few searches in each place are kept on your device and nowhere else'],
      ['imp', 'Search only ever looks where you can read. A private channel you cannot open, or a channel whose history is hidden from you, never turns up in your results'],
      ['add', 'On a phone, search is a screen of its own. The header there has no room for a box worth typing into, so the magnifier opens one that does'],
      ['add', 'Scroll back through the whole of a channel. It used to show its newest fifty messages and nothing before them, so a reply to anything older had nothing to jump to. Older messages now load as you scroll up, all the way to the first one, and a reply quote, a pinned message or a search result takes you to its message however old it is. When you are that far back, a bar says so, counts what has arrived since, and takes you back to the present in one click'],
      ['fix', 'Messages posted in a private channel were still sent to the devices of members who could not open it, and somebody joining a server through an invite saw its private channels listed until they reloaded. Who sees a channel is now decided by one rule everywhere — the channel list, what the server hands over, and what arrives live — and a change to roles or channel permissions takes effect straight away, without a reload'],
      ['add', 'The Members tab on a role does its job. Since roles arrived it has been a placeholder; now it lists who holds the role, with a box to filter them, and Add members offers everyone you are allowed to give it to. Taking a role away is one click, the role list shows real counts instead of a dash, and all of it updates live when somebody else changes a role'],
      ['imp', 'Menus follow permissions rather than ownership. The server menu, the channel and category menus and the plus for a new channel now appear for whoever holds Manage Channels or Manage Server. The permissions already allowed those things; the menus had not caught up'],
      ['fix', 'Dragging a category to a new place did nothing: it lifted, showed where it would land, and went back. It moves now — and categories also have Move Up and Move Down in their menu, for a keyboard, or a trackpad where a long drag is fiddly'],
      ['fix', 'The channel header showed the same line, “Discuss anything on Skycord”, for every channel. It shows the channel’s own topic now, with the full text on hover when it is long'],
      ['fix', 'The permissions page stacks its columns in a narrow window instead of squeezing them past the edge, and keyboard focus no longer vanishes when its save bar goes away'],
      ['fix', 'Tooltips no longer replace the names screen readers use for buttons that already had one']
    ]
  },
  {
    v: 'v0.18.0', date: 'Sep 10, 2026', time: '18:15 UTC+2', title: 'Moderation in voice, and switches that mean it',
    items: [
      ['add', 'Server Mute, Server Deafen and Disconnect. Right-click somebody sitting in a voice channel and, if you have the permission and outrank them, you can silence them for the whole room, cut them off from hearing it, or drop them out of the call. A mute sticks until somebody lifts it — leaving and coming back does not clear it, and neither does restarting the app. Disconnecting is not a punishment that lasts: they can walk straight back in, which is the point of having it separate from kicking'],
      ['add', 'Drag your channels into whatever order you like, inside a category or out of one, and drag the categories themselves into order too. Until now a sidebar could only ever be in the order things were created in, because nothing could write an order back'],
      ['imp', 'Speak and Video are real permissions now. Take Speak away in a channel and people can join and listen but cannot transmit — they arrive muted with no way to unmute. Take Video away and the camera and screen-share buttons stop being offered rather than failing when pressed. Both are enforced by the voice server itself, so they hold whatever the app is asked to do'],
      ['imp', 'Use Voice Activity forces push-to-talk on the people who do not have it — a way to keep a noisy channel usable. It is marked App-enforced in the permission list, and that label is doing real work: unlike the others, this one is honoured by the app rather than by the voice server, so treat it as tidying rather than as silencing somebody. Server Mute is the one that silences'],
      ['add', 'Read Message History, Mention @everyone, Add Reactions and Manage Messages all do something now. Without Read Message History a channel opens empty and fills up from the moment you arrive — you can still post. Without Mention @everyone the words still appear exactly as typed, because nobody should have their message edited to enforce a setting, but the channel does not light up. Without Add Reactions you cannot start a new reaction, though you can always join one somebody else started, and you can always take your own back'],
      ['add', 'Manage Messages covers pinning and deleting other people’s messages. Pinning used to be open to every member, including unpinning what a moderator had pinned. Deleting somebody else’s message could not be done by anyone at all, owner included, which meant a channel could not really be moderated. It can now — and it still never lets anyone EDIT what another person wrote, which is not moderation and never will be'],
      ['fix', 'Fifteen permission switches were doing nothing. The last release said seven were waiting on features that did not exist yet; the truth was that fifteen more were switches you could set, that read as working, and that changed no behaviour whatsoever. Turning off Speak did not stop anyone speaking. All fifteen are either enforced as of this release or labelled honestly, and there is now an automated check that fails if a switch is ever added without one or the other'],
      ['imp', 'The permission list says which kind of gap each unfinished switch has. Soon means the feature itself does not exist yet, so there is nothing to grant — twelve of them, including bans, attachments, custom emoji and the audit log. That is up from the seven claimed last time, which was an undercount rather than a regression'],
      ['fix', 'Clicking two servers quickly could leave you looking at one server’s channel list with another server’s conversation open beside it, if the second one finished loading first'],
      ['fix', 'Channel rows were announced to screen readers as a single control when they are two — the channel itself and the menu beside it — which left that menu unreachable without a mouse. The same was true of category headers and the buttons on them'],
      ['imp', 'Rearranging channels only needs Manage Channels now, rather than being the server owner’s alone. Anyone who could already rename a channel from its menu could not drag that same channel, which made no sense from either side']
    ]
  },
  {
    v: 'v0.17.0', date: 'Sep 2, 2026', time: '10:40 UTC+2', title: 'Roles, and channels only some people can open',
    items: [
      ['add', 'Roles. A server can have them now — a name, a colour, and a set of things holders are allowed to do. They live under Server Settings, they sit in an order, and that order is what decides who can edit whom: you can only manage a role below your own. Everyone already has @everyone, which is the floor the rest sit on'],
      ['add', 'Private channels. Open the settings for a channel, switch on Private, and pick the roles and people who get in. Everyone else stops seeing it entirely — it is gone from their sidebar, not greyed out, and the server refuses to hand over its messages even to someone who knows its address. If you would rather people could see that it exists and ask for access, there is a switch for that too'],
      ['add', 'Private voice channels lock joining as well as seeing. A voice channel that is merely hidden is still joinable by anyone who has been in it before, so switching one to private takes away both at once'],
      ['add', 'Categories carry permissions, and the channels inside follow along. Lock a category and everything under it is locked, with no copying and nothing to keep in step. A single channel can still open itself back up if you want one public room inside a private group'],
      ['add', 'An Advanced section on every channel and category, for the cases the Private switch cannot express — every permission individually set to allow, deny, or left to inherit from whatever is above it'],
      ['imp', 'Jobs that used to be owner-only are now permissions you can hand out. Creating and renaming channels, editing the server, managing invites and voice servers, kicking people — all of them can go to a role instead of only to you. Deleting the server stays yours alone, and no permission will ever grant it'],
      ['imp', 'Administrator grants everything and still does not reach the owner. An administrator cannot kick you, cannot ban you, cannot edit your roles, and cannot delete your server. That is not a setting; it is how the model is built'],
      ['imp', 'Anyone can create an invite by default now, rather than only the owner. If you would rather they could not, turn Create Invite off for @everyone under Roles'],
      ['imp', 'Every permission has a plain description saying what it actually lets someone do, and what it looks like when it is switched off. Seven of them are marked Soon — webhooks, slash commands, text-to-speech, nicknames, priority speaker and the audit log describe features Skycord does not have yet, so their switches are disabled rather than quietly doing nothing'],
      ['fix', 'Server settings pages that were listed but empty now say so on the row itself rather than only once you open them']
    ]
  },
  {
    v: 'v0.16.0', date: 'Sep 2, 2026', time: '03:10 UTC+2', title: 'Eight new looks, and a profile worth building',
    items: [
      ['add', 'Eight new themes under Appearance, borrowed from apps you already know the look of: Spotify, Graphite, Linear, Vercel, Stripe, GitHub, Notion and Stoat. Each one brings its own accent colour so it reads as itself straight away, and you can change that accent afterwards without losing the rest of the theme'],
      ['add', 'Save a look you have built, under a name of your own, in Appearance. Saved themes live on the device you saved them on for now — to move one to another computer, or send it to someone else, the share code further down that page already does exactly that'],
      ['add', 'Discover has two tabs now: Servers, and Themes. The Themes tab is a gallery of everything above plus anything you have saved. Click one and it applies immediately — nothing to confirm, and nothing you cannot undo by clicking another'],
      ['imp', 'Your profile is built around your card now. The card used to be a small preview beside a narrow column, with your display name and about-me stranded underneath it while your avatar, banner and status sat in a separate column entirely — two halves of the same thing, pretending to be unrelated. The card is large, it stays put while you scroll, and every control sits in one list beside it, writing to it as you go'],
      ['imp', 'Appearance keeps its preview on screen while you work. It used to sit at the top of the page and scroll away after the first section, which meant eight of the nine things you could change were changing something you could no longer see'],
      ['imp', 'Menus and dialogs now open out of the thing you clicked, the way they do on a Mac, rather than appearing from the middle of the screen with no connection to what you pressed'],
      ['fix', 'The banner colour picker opened in the wrong place. Clicking the banner on your card opened it far away, down beside a different control — because it was pinned to that control rather than to your click. It now opens where you clicked, whichever of the two ways you get to it'],
      ['fix', 'Tapping your avatar on the profile card opened a two-item menu just to reach the thing you had already asked for. It goes straight to the picker'],
      ['fix', 'A thin grey bar sat across the message box on a phone, looking like a scrollbar for something that could never scroll. It was never real — there was nothing to reach sideways'],
      ['fix', 'The GIF button is gone from the message box on a phone, and the space goes to the box you type in. Nothing is lost: the emoji button opens the same picker, already on its GIF tab, so a GIF is still one tap away on a row that now fits four comfortable targets instead of five cramped ones'],
      ['fix', 'The section list in Settings could not reach its own bottom. Scrolling all the way down left the highlight two or three items short, and clicking one of those scrolled as far as it could and then quietly moved the highlight back to where it had been'],
      ['imp', 'The roadmap listed "more themes and customization options" as something being looked at. Most of that shipped here, so it now says what is genuinely still missing: themes that follow you between devices, and somewhere to browse ones other people have made']
    ]
  },
  {
    v: 'v0.15.2', date: 'Sep 1, 2026', time: '11:38 UTC+2', title: 'Video calls, and a picker that fits your thumb',
    items: [
      ['add', 'The video button in a conversation actually starts a video call now — it used to say "coming soon". Press it and you get the camera preview first: pick which camera, see yourself, then join with video already on. If you are in a call and your camera is live, the same button turns it off. Hanging up stays with the phone button next to it'],
      ['imp', 'The emoji, GIF and sticker picker is a proper bottom sheet on a phone. It used to be a small floating card designed for a mouse, wedged above the message box with a strip of chat still showing beside it. Now it comes up from the bottom edge, fills the width, dims the app behind it, and closes when you tap away'],
      ['fix', 'The picker had no way out — it disappeared the instant you dismissed it, on computers too. It slides away now'],
      ['fix', 'Screen sharing from a phone was a button that did nothing at all and said nothing about why. It is now switched off with an explanation. Phone browsers genuinely cannot capture a screen — neither iPhone nor Android allows it from a web page, whatever the app. It needs the desktop app, which is on the way']
    ]
  },
  {
    v: 'v0.15.1', date: 'Sep 1, 2026', time: '11:00 UTC+2', title: 'Calmer, and easier to hit',
    items: [
      ['add', 'A Reduce motion switch, under Appearance. Turns off animations and transitions across the app — worth a try if Skycord feels sluggish on an older machine, or if movement bothers you. Loading spinners keep turning either way, because they are telling you something is happening rather than decorating. If your phone or computer already asks for less motion, that is respected whether this is on or off'],
      ['fix', 'Buttons in Settings and in the emoji, GIF and sticker pickers were too small to hit reliably on a phone — the emoji category strip was 28 pixels, about half what a thumb needs. Everything is a proper size now, and the category strip scrolls sideways instead of squeezing itself to fit'],
      ['fix', 'Tapping the search box in the emoji or GIF picker on an iPhone zoomed the whole page in and never zoomed back out'],
      ['imp', 'Messages no longer bounce as they arrive. Each one used to overshoot its place and settle back, which is charming the first time and tiring by the hundredth. It still slides in, just calmly, and quicker than before'],
      ['imp', 'The little toolbar on a message now fades in instead of snapping into existence, and it no longer sits invisibly in the way of a click'],
      ['imp', 'Less fidgeting in general. Things used to grow when you pointed at them — the avatar on every message, the buttons beside the message box, the reaction pills. Hovering now just changes colour, and the squeeze happens when you actually press. Reaction pills gained that press feedback, which they never had'],
      ['fix', 'The emoji and attachment buttons by the message box gave no sign they had been clicked on a computer'],
      ['fix', 'The loading screen could stay on top of everything after the app had finished loading, if you opened Skycord in a background tab. It cannot block you now'],
      ['imp', 'The roadmap said we were looking at "a stronger noise filter" — which is what shipped back in July. Rewritten to say what is actually still missing: handling clatter and echoey rooms, and separately, filtering out other people talking near you, which is a harder problem and not solved']
    ]
  },
  {
    v: 'v0.15.0', date: 'Sep 1, 2026', time: '06:59 UTC+2', title: 'Everywhere you are signed in',
    items: [
      ['add', 'Settings now has a Devices page: every place your account is signed in, what it is — “Chrome on Windows”, “Safari on iOS” — the address it connected from with that country’s flag beside it, and when it was last used. If a row is not you, sign it out from there'],
      ['add', 'Sign out one device, or all the others at once and keep the one you are holding. The Account page used to have a “Logged-in Devices” row that read “1 device” next to an arrow that did nothing — the number was made up, and it was never true for anyone signed in twice. It goes to the real page now'],
      ['imp', 'Working out the country happens on your own server, from a database on its disk. Nobody is told your address to draw a flag on it. It is a rough lookup and the page says so — a VPN or a phone network is often put in the wrong country'],
      ['fix', 'Signing out on one device signed you out on all of them. Close a session on a shared computer and your phone was logged out too, with no way to do one without the other. It signs out the one you are on'],
      ['fix', 'Changing your password did not sign your other devices out. That is backwards — someone changes their password precisely because they think a session somewhere is not theirs, and that was the one case where nothing happened. Every other device is signed out now, and you keep the one you are using'],
      ['fix', 'Declining a friend request did nothing at all. The row disappeared and the request was still there when you came back, and the person who sent it never found out. It actually declines it'],
      ['fix', 'The Friends tab on a phone was broken, not merely cramped. “Add Friend” was five pixels wide at the edge of the screen, the list was squeezed into a quarter of the width with every name invisible, and each row’s buttons were drawn outside the row on top of the column next to it. Rebuilt: one column, the tabs across the full width, names that fit, and everything big enough to hit with a thumb'],
      ['fix', 'A profile picture, banner or sticker could point anywhere — including at a page of someone’s choosing that quietly records the address and browser of everyone who looks at the profile. Only the size was ever checked. Now the address has to be a real image from a safe source'],
      ['imp', 'Theme codes you copy and paste now start with “skycord-theme:”. They used to say “sykord” — a spelling mistake in a folder name that had leaked out into the one part of this feature people actually read. Codes with the old spelling keep working, including ones already sitting in your messages'],
      ['imp', 'Buttons that are only an icon — closing a dialog, showing a password, the toggles in settings — now say what they do to a screen reader. Twenty-two of them said nothing at all'],
      ['imp', 'Small honesty fixes: the empty pictures in the Friends tab are proper icons rather than emoji, the “no friends” message says which thing is empty, and the two-factor and devices rows no longer pretend to be finished when they are not']
    ]
  },
  {
    v: 'v0.14.1', date: 'Aug 31, 2026', time: '02:40 UTC+2', title: 'One place to put your voice servers',
    items: [
      ['add', 'If you run Skycord yourself and have more than one voice server, you can now offer all of them to everyone on your instance at once. They go in a file next to your other settings, and every server on that instance can point a channel at any of them — instead of each owner adding the same ones by hand, over and over, and again every time a key changes'],
      ['imp', 'Your keys stay yours. A server owner picking one of your voice servers never sees the credentials for it — before this, the only way to share one was to hand them over. Nothing about them is written to the database or sent to a browser'],
      ['imp', 'They show up in every server’s voice settings marked as coming from the instance, and cannot be edited or deleted from inside the app — they are yours, not the app’s. Shown rather than hidden, so nobody re-adds a server that was already there'],
      ['fix', 'A bad entry in that file now stops the server from starting and says which entry is wrong, instead of looking fine until somebody joins a call and it does not work'],
      ['imp', 'Nothing changes if you do not use it. Instances with one voice server carry on exactly as before, with no file and nothing to configure'],
      ['imp', 'Notices in the app — the one about who can see your screen, and the one about a host disconnecting — read as part of the app now instead of a generic warning box']
    ]
  },
  {
    v: 'v0.14.0', date: 'Aug 30, 2026', time: '20:45 UTC+2', title: 'Your own voice servers',
    items: [
      ['add', 'Run your own voice servers and point channels at them. A server owner adds theirs once, and a voice channel can sit on whichever one is closest to the people using it — everyone in that channel connects to the same one, because a call only works if all of it is in one place'],
      ['add', 'Direct and group calls get a choice too: pick a default in Voice &amp; Video, and anyone in the call can move it while it is running. Everybody in the call moves together — it is their call, not whoever dialled first'],
      ['add', 'Every call now says which server it is on, in the connection panel. Whoever runs the machine your voice passes through can record what crosses it, so being sent to one is never silent'],
      ['add', 'A proper Edit Channel dialog — a topic, slowmode, a user limit, bitrate, invites, and the voice server, instead of renaming being the only thing you could change'],
      ['fix', 'Slowmode did nothing. It saved, it showed up in the dialog, and no part of sending a message ever looked at it, so anyone could post as fast as they liked. It works now: the wait is counted from your last message that actually landed, so a refresh or a second tab does not reset it. The box tells you how long is left, hands your text back rather than eating it, and says plainly when you are the one it does not apply to'],
      ['fix', 'A channel could quietly point at a voice server belonging to a different community — a setting that looked saved and did nothing. Refused now, rather than stored and ignored'],
      ['fix', 'Deleting a server left its voice servers behind in the database, unreachable and holding an encrypted key nothing could ever delete']
    ]
  },
  {
    v: 'v0.13.0', date: 'Aug 30, 2026', time: '18:10 UTC+2', title: 'Run it yourself, properly',
    items: [
      ['add', 'Self-hosting is real now, not a promise. Full guides for the whole thing: installing it, putting it on a domain, certificates, the firewall, email, backups — written from the server this instance actually runs on, mistakes included'],
      ['add', 'Pick how far you want to go. On your own machine takes minutes and skips almost all of it. Public with encryption is a middle step. Fully locked down is there if you want it. Only one combination genuinely does not work, and the server refuses to start in it rather than let you discover that through a login that never sticks'],
      ['fix', 'The part of Skycord that handles logins was answering the internet directly, on its own port, without encryption — alongside the proper encrypted route, not instead of it. Nothing suggests it was ever used, and the limits on login attempts applied there too, but it was a way in that had no reason to exist. It now only accepts connections from the machine it runs on'],
      ['fix', 'A self-hosted server used to hand out a certificate naming its own domain to anyone who asked for it by address — which is how a server behind a shield gets found anyway. The guides now close that, and say plainly which parts of hiding a server actually work and which are decoration'],
      ['fix', 'Two mistakes in those guides, found by reading them against the server they were written from: one page of the app was missing from the setup instructions and would have quietly 404’d, and the advice on voice servers was wrong in a way that would have published your address for no benefit'],
      ['add', 'Instructions for locking down a server and for backing it up. Nothing here backs itself up, and the guide says so rather than letting you assume otherwise'],
      ['imp', 'The encryption plan now requires the protocol to be written and attacked on paper before a line of it is built. Doing that immediately found a hole in this month’s own design — worth catching in a document rather than in a release']
    ]
  },
  {
    v: 'v0.12.8', date: 'Aug 30, 2026', time: '07:31 UTC+2', title: 'Open source, and a way back in',
    items: [
      ['add', 'Forgot your password? There is finally a way out. Ask for a link, click it, pick a new one — and every device signed into that account gets signed out, which is the point if the reason you are resetting is that somebody else is signed in'],
      ['add', 'Skycord is open source, AGPL, and the whole thing is on GitHub. Not a teaser repo — the code that runs this instance is the code you can read'],
      ['add', 'You can run your own. Guides for the whole thing: installing it, putting it on a domain, TLS and Cloudflare, the firewall, and the mail setup — written from the server this one actually runs on, including the mistakes that made it break'],
      ['imp', 'A server can now say when something is not set up rather than pretending it broke. No GIF key means "GIFs aren’t set up here" and a link to fix it, not a spinner and a lie'],
      ['fix', 'A self-hosted instance can no longer start with login cookies that anything on the network could read. It refuses to boot and says which setting is wrong — the sort of mistake that otherwise looks exactly like a working install'],
      ['imp', 'Running on Node 22, and the project now says so, so nobody spends an evening on a version that quietly cannot build it']
    ]
  },
  {
    v: 'v0.12.5', date: 'Aug 30, 2026', time: '05:51 UTC+2', title: 'Discover, and a long list of small wrongs',
    items: [
      ['add', 'Discover — a directory of servers, behind the compass in the rail. A server appears there only if its owner published it, so nothing private is ever listed; publishing arrives with Server Settings'],
      ['fix', 'The connection strip could say “Reconnecting…” forever over a connection that had already given up. Access tokens last fifteen minutes and are renewed on a timer, and timers stop while a laptop sleeps — so waking up reconnected with a token that expired mid-sleep, and nothing retried. It refreshes and reconnects on its own now'],
      ['fix', 'Clicking anything in the left rail flashed a white block behind it. The press highlight was a rectangle drawn across a square hit area wrapping a round icon'],
      ['fix', 'Tooltips on Home, Add Server and Explore appeared above the icon, landing on top of the next server. They sit beside it now'],
      ['fix', 'Discover borrowed the channel list of whichever server you were in last'],
      ['imp', 'Category headers read like headers: the name starts where the channel names start, with the arrow next to it instead of adrift at the far edge'],
      ['imp', 'A voice channel you are in no longer tints its row — the green icon and the list of who is in there already said so twice'],
      ['imp', 'Clicking with a mouse no longer leaves a focus ring behind. Keyboard focus still shows one; that is who it was for'],
      ['imp', 'More room for messages on a phone: a shorter header, no scrollbar eating into the server rail, and a composer that clears the home indicator instead of sitting under it'],
      ['imp', 'The send button on a phone stopped being a large grey square beside two bare icons'],
      ['fix', 'The eye that reveals your password moved around, and sometimes off the edge, depending on the phone. The login screen had no mobile handling at all'],
      ['imp', '“Go idle after” moved from Profile to Account. Profile is what other people see; how long your own inactivity takes to register is not part of that']
    ]
  },
  {
    v: 'v0.12', date: 'Aug 30, 2026', time: '01:07 UTC+2', title: 'The phone catches up',
    items: [
      ['add', 'Servers and channels on your phone at all — the server rail sits beside the channel list, where before there was no way to reach a server from a phone'],
      ['add', 'Tapping a channel, or a voice channel, actually opens it. It used to load behind the list and leave you looking at the list'],
      ['imp', 'Everything you tap is thumb-sized now, including the call controls, which were smaller than a fingertip — the two device pickers were 18 pixels wide'],
      ['imp', 'The buttons that only appeared when you hovered — making a channel, opening a channel menu — are simply there on a phone, where hovering does not exist'],
      ['fix', 'A long display name in a call stretched its tile wide enough to push everyone else onto another row'],
      ['fix', 'Every text box, slider and picker now tells a screen reader what it is; a placeholder is not a label']
    ]
  },
  {
    v: 'v0.11', date: 'Aug 25, 2026', time: '01:28 UTC+2', title: 'Servers, channels, and a lot of small honesty',
    items: [
      ['add', 'Servers with real text and voice channels, grouped into categories you can collapse'],
      ['add', 'Invite links — including one that drops the person straight into the voice channel you are sitting in'],
      ['add', 'A member list showing who is online, and who is in voice without you opening the call'],
      ['add', 'Mute, deafen and screen-share show on people in the channel list, so you can see the room at a glance'],
      ['add', 'Right-click someone in a voice channel for their profile, or to set their volume just for you'],
      ['add', 'Statuses that expire on their own — set one for an hour and forget about it'],
      ['add', 'Owners can drag a channel from one category into another'],
      ['add', 'Keyboard shortcuts, the same ones you already know: Ctrl+K to jump anywhere, Ctrl+Shift+M to mute, Ctrl+Shift+D to deafen, Alt and the arrow keys to change channel'],
      ['add', 'A Keybinds page in settings that lists them, instead of the placeholder that was there'],
      ['add', 'Shift+Enter writes a second line. The message box used to be a single-line field that could not hold one'],
      ['add', 'Deleting a message asks first, and quotes the message back so you can see which one you are about to lose'],
      ['imp', 'Menus, popouts and flyouts now close the way they opened. Seven of them used to fade in over a quarter of a second and then vanish between two frames'],
      ['imp', 'Buttons respond when you press them, not only when you point at them'],
      ['imp', 'Menus grow out of the thing you clicked instead of appearing from nowhere'],
      ['imp', 'Right-clicking a message gives you a menu you can drive with the arrow keys — it was the one menu in the app you could only use with a mouse'],
      ['imp', 'The whole app is reachable by keyboard now: the server rail, the channel list, and the buttons on a message. There is a skip link to jump straight to the message box'],
      ['imp', 'The selected channel is marked with an outline instead of a colour fill, so you can tell an open text channel and the voice channel you are sitting in apart'],
      ['imp', 'Long messages stop running the full width of a wide monitor'],
      ['imp', 'Settings sections that are not built yet say Soon, rather than looking finished until you click them'],
      ['fix', 'Timestamps and placeholder text were too faint to read. They failed a readability check on every single theme'],
      ['fix', 'The open channel was invisible in both light themes'],
      ['fix', 'Enter on a delete confirmation used to press Delete. It presses Cancel now'],
      ['fix', 'Mark as Unread did nothing at all. It has been removed rather than left there looking real'],
      ['fix', 'The loading placeholder appeared above your messages instead of in place of them']
    ]
  },
  {
    v: 'v0.10.1', date: 'Aug 17, 2026', title: 'Who is actually here',
    items: [
      ['fix', 'Everyone showed as offline in group members and the direct message list, even while they were online'],
      ['fix', 'Invisible is properly invisible again — it used to be readable as its own state instead of looking offline'],
      ['fix', 'Going idle now shows to your friends, not only to you'],
      ['imp', 'Choose how long you can be inactive before you go Idle, from 1 to 60 minutes. Five by default'],
      ['imp', 'The default profile picture blinks, and each person gets their own colour and their own rhythm']
    ]
  },
  {
    v: 'v0.10', date: 'Aug 17, 2026', title: 'Your phone, your face, your status',
    items: [
      ['add', 'Zoom and reposition your profile picture and your banner, animated ones included'],
      ['add', 'Banners crop in a proper wide window, with the parts you are cutting off dimmed around it'],
      ['add', 'A details screen for any conversation, behind the chevron in the header'],
      ['add', 'Search on the phone expands across the header, with a filter button beside it'],
      ['add', 'Group members are listed under the group name in the chat header'],
      ['imp', 'Your animated picture is framed the way you set it everywhere it appears, not only on your profile'],
      ['imp', 'Animated pictures hold still until you hover them on a computer, and play in short bursts on a phone, so a list of twenty is not twenty things moving at once'],
      ['imp', 'Menus and dialogs on the phone rise from the bottom and can be dragged away'],
      ['imp', 'Buttons across the phone layout are big enough to hit with a thumb'],
      ['imp', 'Online, Idle, Do Not Disturb and Invisible stay as you left them when you close and reopen Skycord'],
      ['imp', 'Skycord sets you to Idle on its own once you have been away a while'],
      ['fix', 'No more white or black band above your banner'],
      ['fix', 'A zoomed profile picture stays inside its circle instead of spilling over the buttons beside it'],
      ['fix', 'Typing into a box on an iPhone no longer zooms the whole page'],
      ['fix', 'The invite dropdown no longer opens every time you open a group'],
      ['fix', 'Your status no longer flips back to Online just because you reconnected']
    ]
  },
  {
    v: 'v0.9', date: 'Aug 14, 2026', title: 'Calls that tell you the truth',
    items: [
      ['add', 'A connection panel with a live ping graph, your average and last ping, and packet loss'],
      ['add', 'A Debug button in it, for when a call sounds wrong and you want to know why'],
      ['add', 'Save or copy those readings as a file, so a bug report can carry the evidence'],
      ['add', 'Camera and screen share moved next to the call status'],
      ['add', 'Right-click whoever you are calling to ring them again, or stop ringing'],
      ['add', 'The person you are calling now appears on the call, dimmed with a ring around them'],
      ['imp', 'The connection indicator is a proper signal meter'],
      ['imp', 'Call controls stay pinned to the bottom of the call'],
      ['imp', 'The call keeps a sensible minimum height'],
      ['imp', 'Fullscreen and hide-chat only appear when there is a camera or screen'],
      ['fix', 'Connection wobbles no longer turn pictures into grey letters'],
      ['fix', 'Skycord no longer starts ringing at a person you are already talking to'],
      ['fix', 'Faces stay centred in the call while you drag it bigger or smaller'],
      ['fix', 'The back-to-call button no longer squashes your name']
    ]
  },
  {
    v: 'v0.8', date: 'Aug 9, 2026', title: 'Skycord on your phone',
    items: [
      ['add', 'Skycord works properly on a phone now'],
      ['add', 'Tap a conversation for a full screen of it'],
      ['add', 'Press and hold anything for its menu'],
      ['add', 'Double-tap a word to select everything'],
      ['add', 'Settings rebuilt for a phone'],
      ['add', 'A connection strip that tells you when you drop out'],
      ['add', 'A back to call button next to your name'],
      ['imp', 'Security hardening throughout'],
      ['imp', 'A new icon set across the whole app'],
      ['imp', 'Hover text on buttons is ours now'],
      ['fix', 'The GIF button in the message box actually opens GIFs'],
      ['fix', 'Hide chat now hides the whole chat'],
      ['fix', 'The app no longer sits below the bottom of the screen']
    ]
  },
  {
    v: 'v0.7.1', date: 'Aug 8, 2026', title: 'Chats stay put',
    items: [
      ['fix', 'Removing someone as a friend no longer makes your conversation disappear'],
      ['imp', 'Your chat list is built from conversations you have actually had']
    ]
  },
  {
    v: 'v0.7', date: 'Aug 8, 2026', title: 'A profile worth showing',
    items: [
      ['add', 'A Profile page in settings'],
      ['add', 'Banner colour: pick anything you like'],
      ['add', 'Or upload a banner image — GIFs animate'],
      ['add', 'Custom status with a timer'],
      ['add', 'Click anyone avatar for their full profile'],
      ['imp', 'Profile popouts rebuilt'],
      ['imp', 'Softer edges, fewer boxes inside boxes'],
      ['fix', 'Clicking your avatar opens your profile'],
      ['fix', 'GIF search no longer shows old results']
    ]
  },
  {
    v: 'v0.6', date: 'Jul 20, 2026', title: 'Right-click everything',
    items: [
      ['add', 'Right-click menus across the app'],
      ['add', 'Pin a conversation to keep it at the top'],
      ['add', 'Mute a conversation for 15 minutes, an hour, 8 hours, a day'],
      ['add', 'Per-person volume, mute and hide-video inside a call'],
      ['add', 'Fullscreen a single stream'],
      ['add', 'A camera preview before you go live'],
      ['add', 'Device menus on the mic and headphone buttons'],
      ['add', 'A dial tone while you wait'],
      ['imp', 'New sound palette — lower, warmer'],
      ['imp', 'The ringtone carries properly on laptop speakers'],
      ['imp', 'Reading older messages no longer yanks you to the bottom'],
      ['imp', 'A jump-to-present button that counts what you missed'],
      ['fix', 'A crash that could stop the app updating'],
      ['fix', 'The camera now fits the call bar at any height'],
      ['fix', 'Muting a conversation silences its calls too'],
      ['fix', 'Groups no longer ding while you have them open']
    ]
  },
  {
    v: 'v0.5', date: 'Jul 19, 2026', title: 'Calls, your way',
    items: [
      ['add', 'Big screen — click any tile to focus it'],
      ['add', 'Fullscreen the call, and a hide-chat mode'],
      ['add', 'Drag the call bar bottom edge to resize it'],
      ['add', 'RNNoise — a stronger noise filter'],
      ['add', 'Input sensitivity now works as a noise gate'],
      ['imp', 'Calls now open at a comfortable size'],
      ['imp', 'A spotlighted stream automatically comes through at higher quality'],
      ['imp', 'Call logs in DMs now show a green start / red end marker'],
      ['fix', 'Input sensitivity and input volume now apply to real calls'],
      ['fix', 'People no longer show as online after closing Skycord'],
      ['fix', 'Calls already running are visible the moment you come online']
    ]
  },
  {
    v: 'v0.4.1', date: 'Jul 12, 2026', title: 'Call menus & polish',
    items: [
      ['add', 'Mic, camera and menu buttons on the call bar'],
      ['add', 'Instant speaking ring for your own voice'],
      ['imp', 'Shared-theme cards in chat got a cleaner look'],
      ['fix', 'Turning your camera off now clears your tile for everyone'],
      ['fix', 'Chrome stop-sharing bar stays in sync']
    ]
  },
  {
    v: 'v0.4', date: 'Jul 11, 2026', title: 'Calls got eyes',
    items: [
      ['add', 'Video calls — everyone can turn on a camera'],
      ['add', 'Screen share with a LIVE badge'],
      ['add', 'Clear errors when a camera or the server is unavailable']
    ]
  },
  {
    v: 'v0.3', date: 'Jun 24, 2026', title: 'Make it yours',
    items: [
      ['add', 'Theme sharing — send your look in chat'],
      ['add', 'Settings got sections, visual density options'],
      ['imp', 'Voice settings: input modes, push-to-talk, mic test']
    ]
  },
  {
    v: 'v0.2', date: 'Jun 23, 2026', title: 'Better together',
    items: [
      ['add', 'Group DMs with invite links and member management'],
      ['add', 'Reply threads, pins, and a quick switcher'],
      ['imp', 'Rich text, stickers, GIF search and reactions']
    ]
  },
  {
    v: 'v0.1', date: 'Jun 20, 2026', title: 'Hello, Skycord',
    items: [
      ['add', 'Voice calls in DMs and groups with self-healing reconnect'],
      ['add', 'Friends, DMs, and real-time everything']
    ]
  }
];

  w.SKYCORD_ROADMAP = ROADMAP;
  w.SKYCORD_RELEASES = RELEASES;
})(window);
