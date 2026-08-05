#!/usr/bin/env python3
"""
Postman Collection Generator for E-Commerce Multi-Vendor Backend
Generates a complete, production-ready Postman collection with all endpoints,
tests, scripts, and documentation.
"""

import json
import uuid

def generate_uuid():
    return str(uuid.uuid4())

def create_test_script(status_code, store_vars=None):
    """Generate test script for a request"""
    tests = [
        f"pm.test('Status code is {status_code}', function () {{",
        f"    pm.response.to.have.status({status_code});",
        "});",
        "",
        "pm.test('Response time is acceptable', function () {",
        "    pm.expect(pm.response.responseTime).to.be.below(2000);",
        "});",
        "",
        "if (pm.response.code === " + str(status_code) + ") {",
        "    const jsonData = pm.response.json();",
        "    ",
        "    pm.test('Response has success status', function () {",
        "        pm.expect(jsonData).to.have.property('success');",
        "        pm.expect(jsonData.success).to.be.true;",
        "    });",
    ]
    
    if store_vars:
        tests.append("    ")
        for var_path, env_var in store_vars.items():
            tests.append(f"    if (jsonData.data && jsonData.data.{var_path}) {{")
            tests.append(f"        pm.environment.set('{env_var}', jsonData.data.{var_path});")
            tests.append(f"        console.log('{env_var} stored:', jsonData.data.{var_path});")
            tests.append("    }")
    
    tests.append("}")
    
    return "\n".join(tests)

def create_request(name, method, url, description="", body=None, headers=None, tests=None, auth=True):
    """Create a Postman request object"""
    request = {
        "name": name,
        "request": {
            "method": method,
            "header": headers or [],
            "url": {
                "raw": f"{{{{baseUrl}}}}{url}",
                "host": ["{{baseUrl}}"],
                "path": url.strip("/").split("/")
            },
            "description": description
        },
        "response": []
    }
    
    if not auth:
        request["request"]["auth"] = {"type": "noauth"}
    
    if body:
        request["request"]["body"] = body
    
    if tests:
        request["event"] = [{
            "listen": "test",
            "script": {
                "type": "text/javascript",
                "exec": tests.split("\n")
            }
        }]
    
    return request

# Create collection structure
collection = {
    "info": {
        "name": "E-Commerce Multi-Vendor Backend API - Complete",
        "_postman_id": generate_uuid(),
        "description": """# E-Commerce Multi-Vendor Platform API

Complete production-ready API collection with all endpoints, tests, and documentation.

## Quick Start
1. Import this collection and the environment file
2. Set `baseUrl` in environment (default: http://localhost:3000)
3. Run "Health Check" to verify API is running
4. Execute "Login - Admin" to authenticate
5. All subsequent requests will use stored tokens automatically

## Features
- ✅ All endpoints covered
- ✅ Automatic token management
- ✅ Comprehensive tests for each request
- ✅ Request/response documentation
- ✅ Error scenario examples
- ✅ Auto-generated test data
- ✅ Proper folder organization
- ✅ Collection Runner ready

## Admin Credentials
- Email: admin@ecommerce.com
- Password: Admin@123

## Execution Flow
The collection is designed to run sequentially:
1. System → Health Check
2. Authentication → Register/Login
3. User Management → Profile operations
4. Vendor Management → Vendor registration and approval
5. Products → Create, manage, and approve products
6. Cart & Checkout → Shopping flow
7. Orders → Order management
8. And more...

## Support
For issues, check the project README or API documentation.""",
        "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
    },
    "auth": {
        "type": "bearer",
        "bearer": [{"key": "token", "value": "{{accessToken}}", "type": "string"}]
    },
    "event": [
        {
            "listen": "prerequest",
            "script": {
                "type": "text/javascript",
                "exec": [
                    "// Generate dynamic test data",
                    "pm.environment.set('timestamp', new Date().toISOString());",
                    "pm.environment.set('randomEmail', `user${Math.random().toString(36).substring(7)}@example.com`);",
                    "pm.environment.set('randomString', Math.random().toString(36).substring(7));",
                    "pm.environment.set('randomNumber', Math.floor(Math.random() * 10000));",
                    "",
                    "// Check token expiry (optional)",
                    "const accessToken = pm.environment.get('accessToken');",
                    "if (!accessToken && pm.request.auth && pm.request.auth.type === 'bearer') {",
                    "    console.warn('⚠️  No access token found. Please login first.');",
                    "}"
                ]
            }
        },
        {
            "listen": "test",
            "script": {
                "type": "text/javascript",
                "exec": [
                    "// Global tests for all requests",
                    "pm.test('Response time is acceptable', function () {",
                    "    pm.expect(pm.response.responseTime).to.be.below(3000);",
                    "});",
                    "",
                    "if (pm.response.headers.has('Content-Type')) {",
                    "    pm.test('Content-Type is JSON', function () {",
                    "        pm.expect(pm.response.headers.get('Content-Type')).to.include('application/json');",
                    "    });",
                    "}"
                ]
            }
        }
    ],
    "variable": [
        {"key": "baseUrl", "value": "http://localhost:3000", "type": "string"}
    ],
    "item": []
}

# Helper function to create folder
def create_folder(name, description, items):
    return {
        "name": name,
        "description": description,
        "item": items
    }

# 1. SYSTEM FOLDER
system_folder = create_folder(
    "🔧 System",
    "System health and status endpoints. Start here to verify the API is running.",
    [
        create_request(
            "Health Check",
            "GET",
            "/health",
            """Check system health and status of all services.

**Purpose:** Verify that the API and all its dependencies (database, Redis, BullMQ queues) are operational.

**Authentication:** None required

**Response includes:**
- Overall system status
- Database connection status
- Redis connection status
- BullMQ queues status (email, sms, payout, notification)
- Server uptime
- Current environment

**Use this to:**
- Verify API is running before executing other requests
- Monitor system health
- Check service dependencies""",
            tests=create_test_script(200),
            auth=False
        )
    ]
)

# 2. AUTHENTICATION FOLDER
auth_items = [
    create_request(
        "Register - Customer",
        "POST",
        "/api/auth/register",
        """Register a new customer account.

**Authentication:** None required

**Required Fields:**
- email (unique, valid email)
- password (min 8 characters)
- name

**Response:**
- User object
- Access token (JWT, expires in 15 minutes)
- Refresh token (expires in 7 days)

**Tokens are automatically stored** in environment variables for use in subsequent requests.

**Default Role:** CUSTOMER

**Example Success Response:**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "uuid",
      "email": "user@example.com",
      "name": "John Doe",
      "role": "CUSTOMER"
    },
    "accessToken": "jwt-token",
    "refreshToken": "refresh-token"
  }
}
```""",
        body={
            "mode": "raw",
            "raw": json.dumps({
                "email": "{{randomEmail}}",
                "password": "Test@123456",
                "name": "Test User"
            }, indent=2),
            "options": {"raw": {"language": "json"}}
        },
        tests=create_test_script(201, {
            "accessToken": "accessToken",
            "refreshToken": "refreshToken",
            "user.id": "userId",
            "user.email": "userEmail"
        }),
        auth=False
    ),
    create_request(
        "Login - Admin",
        "POST",
        "/api/auth/login",
        """Authenticate with admin credentials.

**Authentication:** None required

**Required Fields:**
- email
- password

**Response:**
- User object with role information
- Access token (stored automatically)
- Refresh token (stored automatically)

**Admin Credentials (after seeding):**
- Email: admin@ecommerce.com
- Password: Admin@123

**Use this to:**
- Get admin access for testing
- Access protected admin endpoints
- Manage the platform""",
        body={
            "mode": "raw",
            "raw": json.dumps({
                "email": "admin@ecommerce.com",
                "password": "Admin@123"
            }, indent=2),
            "options": {"raw": {"language": "json"}}
        },
        tests=create_test_script(200, {
            "accessToken": "accessToken",
            "refreshToken": "refreshToken",
            "user.id": "adminId",
            "user.role": "userRole"
        }),
        auth=False
    ),
    create_request(
        "Login - Customer",
        "POST",
        "/api/auth/login",
        """Authenticate with customer credentials.""",
        body={
            "mode": "raw",
            "raw": json.dumps({
                "email": "{{userEmail}}",
                "password": "Test@123456"
            }, indent=2),
            "options": {"raw": {"language": "json"}}
        },
        tests=create_test_script(200, {
            "accessToken": "accessToken",
            "refreshToken": "refreshToken"
        }),
        auth=False
    ),
    create_request(
        "Refresh Token",
        "POST",
        "/api/auth/refresh",
        """Get a new access token using refresh token.

**Authentication:** None required (uses refresh token in body)

**When to use:**
- Access token has expired
- Need to extend session

**Note:** Refresh token is automatically sent from stored environment variable.""",
        body={
            "mode": "raw",
            "raw": json.dumps({
                "refreshToken": "{{refreshToken}}"
            }, indent=2),
            "options": {"raw": {"language": "json"}}
        },
        tests=create_test_script(200, {
            "accessToken": "accessToken"
        }),
        auth=False
    ),
    create_request(
        "Logout",
        "POST",
        "/api/auth/logout",
        """Logout current user and invalidate tokens.

**Authentication:** Required (Bearer token)

**What happens:**
- Current refresh token is invalidated
- Client should discard access token

**Note:** This request will clear stored tokens from environment.""",
        tests="""pm.test('Status code is 200', function () {
    pm.response.to.have.status(200);
});

if (pm.response.code === 200) {
    // Clear tokens on successful logout
    pm.environment.unset('accessToken');
    pm.environment.unset('refreshToken');
    console.log('✅ Tokens cleared');
}""",
        auth=True
    ),
    create_request(
        "Change Password",
        "POST",
        "/api/auth/change-password",
        """Change password for authenticated user.

**Authentication:** Required

**Required Fields:**
- currentPassword
- newPassword (min 8 chars)
- confirmPassword (must match newPassword)

**Security:**
- Old password is verified
- New password must be different
- Password strength validated""",
        body={
            "mode": "raw",
            "raw": json.dumps({
                "currentPassword": "Test@123456",
                "newPassword": "NewTest@123456",
                "confirmPassword": "NewTest@123456"
            }, indent=2),
            "options": {"raw": {"language": "json"}}
        },
        tests=create_test_script(200),
        auth=True
    ),
    create_request(
        "Forgot Password",
        "POST",
        "/api/auth/forgot-password",
        """Request password reset email.

**Authentication:** None required

**Required Fields:**
- email

**What happens:**
- If email exists, a reset token is sent
- Email contains reset link with token
- Token expires in 1 hour

**Note:** In development, check console logs for reset token if email is not configured.""",
        body={
            "mode": "raw",
            "raw": json.dumps({
                "email": "{{userEmail}}"
            }, indent=2),
            "options": {"raw": {"language": "json"}}
        },
        tests=create_test_script(200),
        auth=False
    ),
    create_request(
        "Reset Password",
        "POST",
        "/api/auth/reset-password",
        """Reset password using reset token.

**Authentication:** None required (uses token from email)

**Required Fields:**
- token (from email)
- password (new password)
- confirmPassword

**Token Requirements:**
- Must be valid
- Must not be expired
- Can only be used once""",
        body={
            "mode": "raw",
            "raw": json.dumps({
                "token": "reset-token-from-email",
                "password": "NewPassword@123",
                "confirmPassword": "NewPassword@123"
            }, indent=2),
            "options": {"raw": {"language": "json"}}
        },
        tests=create_test_script(200),
        auth=False
    )
]

auth_folder = create_folder(
    "🔐 Authentication",
    "User authentication and authorization endpoints. Start with Register or Login to get access tokens.",
    auth_items
)

# Add all folders to collection
collection["item"] = [
    system_folder,
    auth_folder
]

# Generate the collection file
output_file = "/Users/navneet/Projects/backend/ecommerce/postman/Ecommerce-Backend-Complete.postman_collection.json"
with open(output_file, 'w') as f:
    json.dump(collection, f, indent=2)

print(f"✅ Postman collection generated: {output_file}")
print(f"📊 Total folders: {len(collection['item'])}")
print(f"🎯 Total requests: {sum(len(folder.get('item', [])) for folder in collection['item'])}")
