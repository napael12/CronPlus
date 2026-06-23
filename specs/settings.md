Add the following settings to 'Settings' section.

These settings will be used when managing this application.   Settings should be stored as json
file under 'backend' directory structure

List of settings:

Setting Name: Notification mailhost:port
Setting Description: SMTP host:port for sending Workflow/Step Notifications
Default Value: smtp.mailhost:25

Setting Name: Notification Sender
Setting Description: 'FROM' email address for notifications
Default Value: admin@cronpl.us.com

Setting Name: Default Timeout (seconds)
Setting Description: Default timeout for individual Step Executions
Default Value: 600

Setting Name: Retain Logs (days)
Setting Description: How long to keep Workflow/Step Runtime Logs
Default Value: 30



Use Vertical Table to display settings.  First Column-setting name; Second Column -setting value.
Add (?) icon with tooltip in first column to display description.
Add dialog for editing each settings value.  If user clicks 'Ok' the setting should be updated, 'Cancel' closes dialog 

