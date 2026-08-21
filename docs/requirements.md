We're going to bootstrap a new web application called Mono. 

Mono is a companion to help you focus and get stuff done during the day. It is specific to the author's needs and may evolve as they change. 

Mono should open with a digital clock showing the current time. It should prompt the user to note his next commitment and at what time. 
Eg: a user opening mono at 2pm and has a daily standup at 5pm, will note that he has the daily standup at 5pm. 

In the settings panel, which can be accessed from mono's header, the user can configure the duration of a focus block, there are two types of focus blocks, large and small (feel free to rename these), the large focus block is 45 min and a small one is 20min by default. 

Based on the user's next commitment time, we should break the time up into primary and secondary focus blocks. Any margin is rounded down rather than up. 
Eg: 50 min time would have 1 focus block and 5 min unfocused.
We should also consider a suitable break time strategy here. At the end of a focus block, the user is prompted as to whether he needs a break, if not, the user can continue and the next focus block begins immediately (large if time is sufficient, small if sufficient). 

if a break is chosen, the user should specify the duration, the focus time calculations should adjust accordingly. 
When starting a focus block, the user will be asked to define a single purpose for the block, and if he finds it difficult to define one, he will given a 5 min timer to evaluate his priorities for the day. 

The UI should have the current time and a timer of the current focus state and on the right a timeline bar, showing the focus blocks and break blocks thus far and the future planned ones. In this timeline view, the user can configure future blocks and breaks as necessary, and create commitments even. 

To give the app a companion feel, we can add an interactive character. You are free to suggest designs for this character