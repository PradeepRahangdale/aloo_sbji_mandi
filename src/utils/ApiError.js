class ApiError extends Error {

    constructor(statusCode,message = "something went wrong",errors=[]){

        super(message);
        this.statusCode = statusCode;
        this.message = message;
        this.sucess = false;
        this.errors = errors
        
        // capture stack trace
        Error.captureStackTrace(this,this.constructor);
    }


}


export { ApiError }