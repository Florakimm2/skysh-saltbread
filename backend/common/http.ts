export function getBearerToken(request: Request) {
    const authorization = request.headers.get("authorization");
  
    if (!authorization) return null;
  
    const [type, token] = authorization.split(" ");
  
    if (type !== "Bearer" || !token) return null;
  
    return token;
  }
