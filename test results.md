Flow 1

Student:

Initial assessment when pdf is clicked 403 error(for both user who registered before the changes we and for the ones who did after)

Initial assessment previously registered(before changes we made) cant find the listening audio(but the question bank is there based on the content admin selected)

The assessment based on grade level selection works

Admin:

When leaving a slot empty(i left reading session 1/2 empty for advanced), the user still can access the assessment page and still get to record even though there is no link for a content there.(meaning you content\_not\_configured logic isnt applying refer to flow 2 to get details)

Flow 2

admin:

when removing and adding content or question bank, it applies real time to the user's assessment page upon refresh meaning content either appears or disappears. (This is why i proposed replace not clear and also once a student opens the assessment page, the changes made to the admin shouldnt apply unless he refreshes meaning he will be evaluated based on the content he saw and respond to(i hope the current submit button sends the assessment artifact along the with content helping to identify to which content the student responded to. If not we not to implement this so that the admin know to what content the student responded.))

If all the slots are empty for a level(rather than the logic of even if one is missing) then "Your assessment is being prepared. Please check back soon." appears on the student assessment page. But even if one skill type is filled the assessment page loads and the skill types with empty content still appear without the content but ability for the student to respond to nothing.I have confirmed if there are no question bank the default free response swoops in

Flow 3:

already addressed aboveFlow 4:

the contents of the skills for the periodic assessment work perfectly(good, unlike the initial assessment)the live changes logic concern I raised on flow 2 applies on this too. Flow 5:

I have confirmed that without saving slot readiness only affects the ui. and when saved then the grid is affected.slot readiness logic confusion: I configured the session number to 2, uploaded 2 content per skill on all levels, then reduced the session number back to 1 and the slots show 2/1 meaning they are still reading the assessment tags on contents and rather than clearing when session number is decreased, they hide them from the ui. then to test further I removed the one content remaining per skill after the reduction of the session number, then the slot show 1/1 because it reading of the second session content which is hidden from the UI and this creates confusion because 1/1 means there one slot and a content is there but that not the case. I don't know how to resolve this confusion without breaking the code because this need ultimate understanding of the page like which controls client side(the admin panel) and which affects the server side before touching anything.