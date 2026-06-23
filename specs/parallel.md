Evaluate ability to run Steps in the Workflow in parallel.  If steps have the same sequence number, they should be launched in parallel. 
The next sequence should wait until previous sequence completed.  All processes with the same sequence must have the same outcome On Success and On Error.  
If outcomes are different, log an error.