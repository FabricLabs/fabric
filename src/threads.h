#ifndef THREADS_H
#define THREADS_H

#include <pthread.h>
#include <stdint.h>
#include <stddef.h>
#include "errors.h"

// Thread safety error codes
typedef enum
{
    THREAD_SUCCESS = 0,
    THREAD_ERROR_MUTEX_INIT_FAILED = 10000,
    THREAD_ERROR_MUTEX_LOCK_FAILED = 10001,
    THREAD_ERROR_MUTEX_UNLOCK_FAILED = 10002,
    THREAD_ERROR_MUTEX_DESTROY_FAILED = 10003,
    THREAD_ERROR_RWLOCK_INIT_FAILED = 10004,
    THREAD_ERROR_RWLOCK_RDLOCK_FAILED = 10005,
    THREAD_ERROR_RWLOCK_WRLOCK_FAILED = 10006,
    THREAD_ERROR_RWLOCK_UNLOCK_FAILED = 10007,
    THREAD_ERROR_RWLOCK_DESTROY_FAILED = 10008,
    THREAD_ERROR_COND_INIT_FAILED = 10009,
    THREAD_ERROR_COND_WAIT_FAILED = 10010,
    THREAD_ERROR_COND_SIGNAL_FAILED = 10011,
    THREAD_ERROR_COND_DESTROY_FAILED = 10012,
    THREAD_ERROR_ATOMIC_OPERATION_FAILED = 10013
} ThreadError;

// Thread-safe mutex wrapper
typedef struct
{
    pthread_mutex_t mutex;
    const char *name;
    int initialized;
} FabricMutex;

// Thread-safe read-write lock wrapper
typedef struct
{
    pthread_rwlock_t rwlock;
    const char *name;
    int initialized;
} FabricRWLock;

// Thread-safe condition variable wrapper
typedef struct
{
    pthread_cond_t cond;
    pthread_mutex_t mutex;
    const char *name;
    int initialized;
} FabricCondition;

// Thread-safe atomic operations
typedef struct
{
    volatile int64_t value;
    FabricMutex mutex;
    const char *name;
    int initialized;
} FabricAtomicInt64;

typedef struct
{
    volatile int32_t value;
    FabricMutex mutex;
    const char *name;
    int initialized;
} FabricAtomicInt32;

// Mutex operations
ThreadError fabric_mutex_init(FabricMutex *mutex, const char *name);
ThreadError fabric_mutex_lock(FabricMutex *mutex);
ThreadError fabric_mutex_unlock(FabricMutex *mutex);
ThreadError fabric_mutex_destroy(FabricMutex *mutex);
int fabric_mutex_is_initialized(const FabricMutex *mutex);

// Read-write lock operations
ThreadError fabric_rwlock_init(FabricRWLock *rwlock, const char *name);
ThreadError fabric_rwlock_rdlock(FabricRWLock *rwlock);
ThreadError fabric_rwlock_wrlock(FabricRWLock *rwlock);
ThreadError fabric_rwlock_unlock(FabricRWLock *rwlock);
ThreadError fabric_rwlock_destroy(FabricRWLock *rwlock);
int fabric_rwlock_is_initialized(const FabricRWLock *rwlock);

// Condition variable operations
ThreadError fabric_condition_init(FabricCondition *cond, const char *name);
ThreadError fabric_condition_wait(FabricCondition *cond, FabricMutex *mutex);
ThreadError fabric_condition_signal(FabricCondition *cond);
ThreadError fabric_condition_broadcast(FabricCondition *cond);
ThreadError fabric_condition_destroy(FabricCondition *cond);
int fabric_condition_is_initialized(const FabricCondition *cond);

// Atomic operations
ThreadError fabric_atomic_int64_init(FabricAtomicInt64 *atomic, const char *name, int64_t initial_value);
ThreadError fabric_atomic_int64_set(FabricAtomicInt64 *atomic, int64_t value);
ThreadError fabric_atomic_int64_get(FabricAtomicInt64 *atomic, int64_t *value);
ThreadError fabric_atomic_int64_add(FabricAtomicInt64 *atomic, int64_t delta, int64_t *result);
ThreadError fabric_atomic_int64_sub(FabricAtomicInt64 *atomic, int64_t delta, int64_t *result);
ThreadError fabric_atomic_int64_inc(FabricAtomicInt64 *atomic, int64_t *result);
ThreadError fabric_atomic_int64_dec(FabricAtomicInt64 *atomic, int64_t *result);
ThreadError fabric_atomic_int64_destroy(FabricAtomicInt64 *atomic);
int fabric_atomic_int64_is_initialized(const FabricAtomicInt64 *atomic);

ThreadError fabric_atomic_int32_init(FabricAtomicInt32 *atomic, const char *name, int32_t initial_value);
ThreadError fabric_atomic_int32_set(FabricAtomicInt32 *atomic, int32_t value);
ThreadError fabric_atomic_int32_get(FabricAtomicInt32 *atomic, int32_t *value);
ThreadError fabric_atomic_int32_add(FabricAtomicInt32 *atomic, int32_t delta, int32_t *result);
ThreadError fabric_atomic_int32_sub(FabricAtomicInt32 *atomic, int32_t delta, int32_t *result);
ThreadError fabric_atomic_int32_inc(FabricAtomicInt32 *atomic, int32_t *result);
ThreadError fabric_atomic_int32_dec(FabricAtomicInt32 *atomic, int32_t *result);
ThreadError fabric_atomic_int32_destroy(FabricAtomicInt32 *atomic);
int fabric_atomic_int32_is_initialized(const FabricAtomicInt32 *atomic);

// Thread safety macros for automatic locking (void* return)
#define FABRIC_MUTEX_LOCK_VOID(mutex)                      \
    do                                                     \
    {                                                      \
        ThreadError __result = fabric_mutex_lock(mutex);   \
        if (__result != THREAD_SUCCESS)                    \
        {                                                  \
            return NULL;                                   \
        }                                                  \
    } while (0)

#define FABRIC_MUTEX_UNLOCK_VOID(mutex)                    \
    do                                                     \
    {                                                      \
        ThreadError __result = fabric_mutex_unlock(mutex); \
        if (__result != THREAD_SUCCESS)                    \
        {                                                  \
            return NULL;                                   \
        }                                                  \
    } while (0)

#define FABRIC_RWLOCK_RDLOCK_VOID(rwlock)                  \
    do                                                     \
    {                                                      \
        ThreadError __result = fabric_rwlock_rdlock(rwlock); \
        if (__result != THREAD_SUCCESS)                    \
        {                                                  \
            return NULL;                                   \
        }                                                  \
    } while (0)

#define FABRIC_RWLOCK_WRLOCK_VOID(rwlock)                  \
    do                                                     \
    {                                                      \
        ThreadError __result = fabric_rwlock_wrlock(rwlock); \
        if (__result != THREAD_SUCCESS)                    \
        {                                                  \
            return NULL;                                   \
        }                                                  \
    } while (0)

#define FABRIC_RWLOCK_UNLOCK_VOID(rwlock)                  \
    do                                                     \
    {                                                      \
        ThreadError __result = fabric_rwlock_unlock(rwlock); \
        if (__result != THREAD_SUCCESS)                    \
        {                                                  \
            return NULL;                                   \
        }                                                  \
    } while (0)

// Thread safety macros for automatic locking (FabricError return)
// These macros work with both FabricError and void* return types
#define FABRIC_MUTEX_LOCK(mutex)                           \
    do                                                     \
    {                                                      \
        ThreadError __result = fabric_mutex_lock(mutex);   \
        if (__result != THREAD_SUCCESS)                    \
        {                                                  \
            return (void*)(intptr_t)FABRIC_ERROR_INTERNAL_STATE_CORRUPTION; \
        }                                                  \
    } while (0)

#define FABRIC_MUTEX_UNLOCK(mutex)                         \
    do                                                     \
    {                                                      \
        ThreadError __result = fabric_mutex_unlock(mutex); \
        if (__result != THREAD_SUCCESS)                    \
        {                                                  \
            return (void*)(intptr_t)FABRIC_ERROR_INTERNAL_STATE_CORRUPTION; \
        }                                                  \
    } while (0)

#define FABRIC_RWLOCK_RDLOCK(rwlock)                       \
    do                                                     \
    {                                                      \
        ThreadError __result = fabric_rwlock_rdlock(rwlock); \
        if (__result != THREAD_SUCCESS)                    \
        {                                                  \
            return (void*)(intptr_t)FABRIC_ERROR_INTERNAL_STATE_CORRUPTION; \
        }                                                  \
    } while (0)

#define FABRIC_RWLOCK_WRLOCK(rwlock)                       \
    do                                                     \
    {                                                      \
        ThreadError __result = fabric_rwlock_wrlock(rwlock); \
        if (__result != THREAD_SUCCESS)                    \
        {                                                  \
            return (void*)(intptr_t)FABRIC_ERROR_INTERNAL_STATE_CORRUPTION; \
        }                                                  \
    } while (0)

#define FABRIC_RWLOCK_UNLOCK(rwlock)                       \
    do                                                     \
    {                                                      \
        ThreadError __result = fabric_rwlock_unlock(rwlock); \
        if (__result != THREAD_SUCCESS)                    \
        {                                                  \
            return (void*)(intptr_t)FABRIC_ERROR_INTERNAL_STATE_CORRUPTION; \
        }                                                  \
    } while (0)

// RAII-style mutex locking (C99 compatible)
#define FABRIC_MUTEX_SCOPE(mutex)                                  \
    for (int __lock_taken = 0; !__lock_taken; __lock_taken = 1)    \
        for (ThreadError __lock_result = fabric_mutex_lock(mutex); \
             __lock_result == THREAD_SUCCESS;                      \
             __lock_result = fabric_mutex_unlock(mutex), __lock_taken = 1)

// Thread safety initialization check macro
#define FABRIC_CHECK_THREAD_SAFE(obj)                      \
    do                                                     \
    {                                                      \
        if (!obj || !obj->initialized)                     \
        {                                                  \
            return FABRIC_ERROR_INTERNAL_STATE_CORRUPTION; \
        }                                                  \
    } while (0)

// Thread ID utilities
typedef pthread_t FabricThreadID;
FabricThreadID fabric_get_current_thread_id(void);
int fabric_thread_id_equal(FabricThreadID id1, FabricThreadID id2);
int fabric_thread_id_is_current(FabricThreadID id);

// Thread safety debugging
void fabric_thread_safety_debug_print(const char *message);
void fabric_thread_safety_set_debug(int enabled);

#endif // THREADS_H
