# WebsiteMaker

This project develops my personal website which will host several engineering and science projects.

`./specs/reqs.md` is the primary project spec. If you ever find issues with the spec or want to change it, consult the user! Never edit the spec without the user's explicit input! If you discover any of the living documents below contradict something in the spec, stop immediately and assess that area of the code carefully, ensuring that we have not implemented something unfaithfully!

Generate living brain docs for recording your process for your reference.

Keep a `./README.MD` up to date with currently live features and features that are currently under construction.

## Logging

Record memory within this project directory and do not use you default memory location. Define new memory for each prompt with the objective of explaining

Do not push to git by default. The user will tell you when to push after they have verified.

Keep detailed commit notes for versions when they are pushed to git.

## Testing
Thoroughly test changes to the website using Playwright.

When generating new tests, store them in `./tests` for future use

.STL, .SLDPRT tests should be done against files found in `./TestDocs`. Never test against newly generated files!

Store test results in `./Testoutput` labeled with date_testname format.

If visual tests are necessary provide png in `./Testoutput`

Set continuous testing criteria and avoid arbitrary point testing.

## Ui Design
Appearance should demonstrate professionalism and organization. Avoid flashy design.

Prefer metric units (mm,N,cm^3) when implementing UI metrics.

Optimize performance, question whether changes to the website will lower performance and set appropriate constraints on features.
- Test simulation upper limits when defined and evaluate performance and responsiveness.
- Define and remember metrics for determining performance impact.
- Remember performance limits when they are discovered to prevent repeating issue.

### Final Design

Attempt to answer your own questions rather than relying on user input.

Only elevate issues to the user when conflicts cannot be resolved by increasing your own context of the issue.

Once an issue is clarified record outcomes for future reference.

### Education

Keep a log of each major change applied to the website with the objective of teaching me about the changes made.

The major objective of this project is to teach me how to use coding agents for web design.

Generate a new file in `./LearningLog` with the format of Date_ProjectTitle which contains an explanation of changes after each commit to git. Do not overwrite or delete logs without user approval! These logs are for educational purpose.
