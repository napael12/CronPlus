The application will maintain username == email|password to authenticate users

The application will support the following roles:  Admin, Operator, Read-Only

Admin -- has permissions to perform all actions

Operator -- has permissions to view Project/Workflow/Steps settings
         -- has permissions to start/stop Workflows/Steps
         -- see logs
         -- see historical Workflow information
Read-only
         -- has permissions to view Project/Workflow/Steps settings
         -- has permissions to start/stop Workflows/Steps
         -- see logs
         -- see historical Workflow information

User, password, role information will be stored in settings database
