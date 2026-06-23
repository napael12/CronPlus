
Users should be able to view what process/steps are currently running and be 
able to 'tail' logs of running processes


Application will store logging information 
1. All changes to Projects/Workflows/Steps

2. Workflow run information:
      - launcher (person|scheduler)   
      - process
      - start time
      - stop time
      - duration
      - outcome:  success|fail
      - peak memory usage MB
      - peak cpu usage %
      - standard output
      - error output

Logging information should be stored 60 days and controlled {store.logs.days}
Logging information should be stored in settings database