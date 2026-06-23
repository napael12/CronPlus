Create project to manage and schedule workflow and tasks

Project Name: CronPlus

Architecture:
Application will use 
    a. python django backend
    b. huey for scheduling
    c. react frontend using shadnc / reui.io  components

Create option to 'compile' frontend to backend for distribution
Application will store settings in database, sqllite by default


Design:
1. Application will consist of a. Projects; b. Workflows; c. Steps

2. Process will represent collection of Workflows

3. Workflows
   a. have optional crontab expression to schedule kick-off
   b. have option to be kicked of manually
   c. contain collection of Steps and/or Workflows to run sequentially or in parallel
   d. when running sequentially, all sequential Workflows/Steps must complete successfully before going to next Step or Workflow
   e. notification settings:  Notify on Success|Notify on Error. Notification recipient
   f. if the last step in workflow completes successfully, workflow outcome is 'success'
      if any of the steps stops on error - workflow outcome is 'fail'

4. Step will represent a way to launch a process 
    a. Command; Parameters;  Working Directory
    b. Step will have 'Outcome' settings with following options: 
            - Go to Next Step - on success or error; 
            - Stop on Error - on error only;

    c. Step should have a timeout setting (-1 by default -- no timeout).  
    If runtime exceeds timeout, process should be stopped, and trigger 'error' status
    
    d. Users should have ability to run individual steps, without running entire workflow. 
    Users should be prompted when running individual steps to follow step 'Outcome'

5. Workflows/Steps may be Active/Inactive.  Inactive Workflow or Step will not run. If inactive
    step is in Workflow sequence, it will be skipped for next Step


Requirements:
1. Create test suite for the application workflows/steps 
2. Create README.md with documentation of the application
3. additional requirements are in variables.md, acl.md, logging.md, notifications.md, ui.md 